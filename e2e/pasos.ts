import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

/**
 * Avanzar de paso en los tests, ahora que no se puede saltar ninguno.
 *
 * «Siguiente» ya no existe hasta superar el reto, así que un test que solo
 * quería llegar al paso 3 tiene que resolver el 1 y el 2 — igual que un
 * usuario. La solución **se lee del propio contenido** (`steps[].solution`) en
 * vez de escribirse otra vez aquí: duplicarla haría que una lección corregida
 * dejara el test verde contra un enunciado que ya no existe.
 */

const RAIZ = join(process.cwd(), 'content/lessons');

interface Solucion {
  path: string;
  content: string;
}

/** Busca el JSON de una lección por su id, sin saber en qué módulo vive. */
function rutaDeLeccion(lessonId: string): string {
  const pila = [RAIZ];
  while (pila.length > 0) {
    const directorio = pila.pop()!;
    for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
      const ruta = join(directorio, entrada.name);
      if (entrada.isDirectory()) pila.push(ruta);
      else if (entrada.name === `${lessonId}.lesson.json`) return ruta;
    }
  }
  throw new Error(`No encuentro la lección ${lessonId}`);
}

/** Solución de referencia de un paso, tal y como la publica la lección. */
export function solucionDelPaso(lessonId: string, stepIndex: number): Solucion[] {
  const lesson = JSON.parse(readFileSync(rutaDeLeccion(lessonId), 'utf8'));
  const solution = lesson.steps[stepIndex]?.solution;
  if (!solution) throw new Error(`${lessonId} paso ${stepIndex} no publica solución`);
  return solution;
}

/**
 * El código con el que la lección se da por terminada.
 *
 * Lo pide el servidor para conceder el XP (ADR-23): terminar ya no es decir
 * que has terminado, es mandar algo que pase las comprobaciones.
 */
export function solucionFinal(lessonId: string): Record<string, string> {
  const lesson = JSON.parse(readFileSync(rutaDeLeccion(lessonId), 'utf8'));
  const archivos: Record<string, string> = Object.fromEntries(
    lesson.workspace.files.map((f: Solucion) => [f.path, f.content]),
  );

  for (const archivo of lesson.steps.at(-1)?.solution ?? lesson.solution?.files ?? []) {
    archivos[archivo.path] = archivo.content;
  }
  return archivos;
}

/**
 * Sustituye el contenido del editor pegándolo de verdad.
 *
 * Con `insertText` Monaco **sí** autocierra: al llegar a un `{` añade su `}`,
 * y el código quedaba con una llave de más al final. En JavaScript el destrozo
 * pasaba desapercibido —el archivo seguía siendo válido—, pero en TypeScript
 * el compilador lo cantaba: `TS1128: Declaration or statement expected` en una
 * línea que el test creía haber escrito bien.
 *
 * Un pegado no dispara el autocierre porque no es una pulsación: es la misma
 * ruta que usa una persona con Ctrl+V.
 */
export async function escribirEnEditor(page: Page, text: string) {
  /*
   * Se comprueba lo que quedó escrito, y se reintenta una vez.
   *
   * Pegar «a ciegas» funcionaba casi siempre y fallaba de vez en cuando: al
   * cambiar de archivo el editor se remonta, y un pegado que caiga en ese
   * hueco se pierde entero. El test acababa diciendo «el paso 3 no pasa con su
   * propia solución» sin que nadie pudiera saber que el archivo estaba vacío.
   */
  /*
   * El testigo se busca al FINAL del texto y sin espacios, por dos motivos
   * que solo se ven fallando:
   *
   * - Monaco **solo pinta las líneas visibles**. Tras pegar, el cursor queda
   *   abajo, así que lo único garantizado en el DOM es el final del archivo:
   *   un testigo de la primera línea no aparece en un archivo largo.
   * - Y pinta los espacios como **no separables**, de modo que una búsqueda
   *   con espacios normales no encuentra nada aunque el texto esté ahí.
   */
  const tokens = text.match(/[^\s]{5,}/g) ?? [];
  const testigo = tokens.at(-1);

  for (const intento of [1, 2]) {
    await page.locator('.monaco-editor').click({ position: { x: 100, y: 40 } });
    await page.evaluate((contenido) => navigator.clipboard.writeText(contenido), text);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+v');

    // Un texto sin ninguna palabra larga no da testigo fiable: se pega y ya.
    if (!testigo) return;

    // Se le da margen a que Monaco pinte: leerlo en el mismo tick devuelve el
    // contenido anterior aunque el pegado haya entrado bien.
    const llego = await page
      .locator('.view-lines')
      .filter({ hasText: testigo })
      .first()
      .waitFor({ state: 'attached', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (llego) return;

    if (intento === 2) {
      throw new Error(`el editor no recibió el texto: falta «${testigo}»`);
    }
    await page.waitForTimeout(500);
  }
}

/**
 * Abre un archivo del árbol si la lección tiene más de uno.
 *
 * Sin esto, la solución de `styles.css` se pegaba encima del `index.html` que
 * el editor traía abierto: el test escribía CSS válido en el archivo
 * equivocado y el paso no se superaba nunca.
 */
export async function abrirArchivo(page: Page, path: string) {
  /*
   * El botón NO se busca por nombre exacto.
   *
   * En cuanto un archivo se toca, el árbol le añade la insignia «Modificado» y
   * su nombre accesible pasa a ser «main.js Modificado». Con `exact: true` eso
   * dejaba de encontrarse, y como esta función calla cuando no hay botón —las
   * lecciones de un solo archivo no tienen árbol—, el cambio de archivo se
   * saltaba **en silencio**: la solución del paso 3 se pegaba encima del
   * archivo que estuviera abierto, y el fallo aparecía luego como «el paso no
   * pasa con su propia solución».
   *
   * Se ancla al principio para no confundir `page.tsx` con `app/page.tsx`.
   */
  const boton = page.getByRole('button', {
    name: new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`),
  });
  if ((await boton.count()) === 0) return;

  await boton.first().click();

  /*
   * Se espera a que el editor **enseñe** ese archivo, no solo a haber pulsado.
   *
   * El editor se remonta al cambiar de archivo, y pegar en ese hueco escribía
   * en el modelo anterior: el contenido de un archivo acababa dentro del otro.
   * El síntoma llegaba lejísimos del sitio —«buscarCallback is not a
   * function»— y solo en las lecciones de varios archivos.
   */
  await expect(page.getByRole('heading', { name: path })).toBeVisible({ timeout: 15_000 });

  /*
   * El título ya dice el archivo nuevo, pero el editor se remonta con él y
   * durante ese hueco lo que se escriba se le atribuye al modelo anterior:
   * el contenido de un archivo acababa dentro del otro, con los dos ilegibles.
   * Se espera a que el editor vuelva a estar montado y quieto.
   */
  await page.waitForSelector('.monaco-editor .view-lines', { timeout: 15_000 });
  await page.waitForTimeout(400);
}

/**
 * Pasa al siguiente paso y espera a que la pantalla asiente.
 *
 * Al cambiar de paso la lección reabre su archivo de foco, y escribir antes de
 * eso dejaba el contenido en el archivo equivocado: los `regex-must` del paso
 * fallaban sobre una solución correcta y el fallo no señalaba a ningún sitio.
 */
export async function avanzarPaso(page: Page, siguiente: number, total: number) {
  await page.getByRole('button', { name: /^siguiente$/i }).click();

  // Dentro de la tarjeta del reto: el contador también sale en la guía, y sin
  // acotar la búsqueda el selector encuentra dos y se queja.
  await expect(
    page.locator('[data-widget="challenge"]').getByText(`Paso ${siguiente} de ${total}`),
  ).toBeVisible({ timeout: 15_000 });

  /*
   * Y se espera a que el editor termine de abrir el archivo de foco del paso.
   *
   * El cambio de paso reabre ese archivo por su cuenta, y si el test empieza a
   * escribir antes, el cambio llega a mitad del pegado y se lleva por delante
   * lo escrito. Es una espera de test, no de producto: una persona no teclea
   * en los 300 ms siguientes a pulsar «Siguiente».
   */
  await page.waitForTimeout(600);
}

/**
 * Resuelve el paso actual con la solución de la lección y pasa al siguiente.
 *
 * Espera a que el botón cambie de «Evaluar» a «Siguiente»: es la prueba de que
 * el paso se dio por superado, no un `waitForTimeout` con los dedos cruzados.
 */
export async function resolverPaso(page: Page, lessonId: string, stepIndex: number) {
  for (const archivo of solucionDelPaso(lessonId, stepIndex)) {
    await abrirArchivo(page, archivo.path);
    await escribirEnEditor(page, archivo.content);
  }

  await page.getByRole('button', { name: /^evaluar$/i }).click();

  const siguiente = page.getByRole('button', { name: /^siguiente$/i });
  await expect(siguiente).toBeVisible({ timeout: 30_000 });
  await siguiente.click();
}
