import { expect, test, type Page } from '@playwright/test';
import { escribirEnEditor, solucionDelPaso } from './pasos';

/**
 * TypeScript con el compilador de verdad (ADR-25).
 *
 * Estas lecciones **no tienen test de Node**, y no por dejadez: el compilador
 * que las juzga es el que trae Monaco, y Monaco solo existe en un navegador.
 * Comprobarlas con el paquete `typescript` de `node_modules` sería comprobar
 * *otro* compilador y dar por buena una lección que en pantalla falla.
 *
 * Así que aquí se hace lo mismo que en `tests/php-lessons.test.ts`, pero
 * donde toca: cada paso de cada lección, con su solución, contra el motor que
 * usa el usuario.
 */

const LECCIONES = [
  'ts-01-tipos-que-fallan-antes',
  'ts-02-uniones-y-narrowing',
  'ts-03-genericos',
] as const;

async function waitForEditor(page: Page) {
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await expect(page.locator('.view-lines')).not.toBeEmpty({ timeout: 20_000 });
}

const consola = (page: Page) => page.getByRole('log', { name: /consola/i });

test('⭐ un error de tipos se enseña como lo enseña tsc, y no se ejecuta nada', async ({ page }) => {
  await page.goto('/es/play/frontend/ts-01-tipos-que-fallan-antes');
  await waitForEditor(page);

  await escribirEnEditor(page, "const x: number = 'no soy un numero';\nconsole.log('llegué');\n");
  await page.getByRole('button', { name: /ejecutar/i }).click();

  const salida = consola(page);
  // Archivo, línea, código y mensaje: las cuatro piezas que se aprenden a leer.
  await expect(salida).toContainText('main.ts(1)', { timeout: 40_000 });
  await expect(salida).toContainText('TS2322');
  await expect(salida).toContainText("Type 'string' is not assignable to type 'number'");

  /*
   * Y lo más importante: **no se ejecuta**. Si el código corriera igual, la
   * lección estaría enseñando lo contrario de lo que dice — en TypeScript el
   * fallo llega antes de arrancar.
   */
  await expect(salida).not.toContainText('llegué');
});

test('⭐ el número de línea es el del archivo, no el de una versión anterior', async ({ page }) => {
  await page.goto('/es/play/frontend/ts-01-tipos-que-fallan-antes');
  await waitForEditor(page);

  await escribirEnEditor(page, "const a = 1;\nconst b = 2;\nconst c: string = a + b;\n");
  await page.getByRole('button', { name: /ejecutar/i }).click();

  // El error está en la tercera línea y ahí tiene que decir que está.
  await expect(consola(page)).toContainText('main.ts(3)', { timeout: 40_000 });
});

test('⭐ lo que compila se ejecuta, con su salida por consola', async ({ page }) => {
  await page.goto('/es/play/frontend/ts-01-tipos-que-fallan-antes');
  await waitForEditor(page);

  await escribirEnEditor(
    page,
    'function conIva(precio: number): number {\n  return precio * 1.21;\n}\nconsole.log(Math.round(conIva(100)));\n',
  );
  await page.getByRole('button', { name: /ejecutar/i }).click();

  await expect(consola(page)).toContainText('121', { timeout: 40_000 });
});

/*
 * Cada paso de cada lección, con su solución publicada.
 *
 * Es el equivalente del test de contenido de PHP: si una solución no compila
 * —o compila pero no imprime lo que la lección promete— quien la resuelva bien
 * vería sus comprobaciones en rojo, y nadie se enteraría hasta entonces.
 */
for (const leccion of LECCIONES) {
  test(`⭐ ${leccion}: cada paso se supera con su solución`, async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto(`/es/play/frontend/${leccion}`);
    await waitForEditor(page);

    const pasos = 3;
    for (let paso = 0; paso < pasos; paso++) {
      const [archivo] = solucionDelPaso(leccion, paso);
      await escribirEnEditor(page, archivo.content);
      await page.getByRole('button', { name: /^evaluar$/i }).click();

      await expect(
        page.getByText(/todas las pruebas superadas/i),
        `el paso ${paso + 1} de ${leccion} no pasa con su propia solución`,
      ).toBeVisible({ timeout: 60_000 });

      if (paso < pasos - 1) {
        await page.getByRole('button', { name: /^siguiente$/i }).click();
      }
    }
  });
}

test('⭐ el módulo de TypeScript aparece en la ruta de Frontend', async ({ page }) => {
  await page.goto('/es/tracks/frontend');
  await expect(page.getByRole('heading', { name: 'typescript' })).toBeVisible();
});
