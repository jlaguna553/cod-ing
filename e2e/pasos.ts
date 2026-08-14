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

/** Sustituye el contenido del editor de golpe (sin disparar el autocierre). */
export async function escribirEnEditor(page: Page, text: string) {
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}

/**
 * Abre un archivo del árbol si la lección tiene más de uno.
 *
 * Sin esto, la solución de `styles.css` se pegaba encima del `index.html` que
 * el editor traía abierto: el test escribía CSS válido en el archivo
 * equivocado y el paso no se superaba nunca.
 */
async function abrirArchivo(page: Page, path: string) {
  const boton = page.getByRole('button', { name: path, exact: true });
  if ((await boton.count()) > 0) await boton.first().click();
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
