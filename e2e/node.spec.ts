import { expect, test, type Page } from '@playwright/test';
import { abrirArchivo, avanzarPaso, escribirEnEditor, solucionDelPaso } from './pasos';

/**
 * Node simulado en el navegador (ADR-26).
 *
 * El prelude se prueba contra el Node de verdad en `tests/node-runtime.test.ts`
 * —comparando `path`, `events` y `fs` con los módulos originales—, así que
 * aquí se comprueba lo otro: que el camino completo funciona en la pantalla y
 * que **cada paso de cada lección se supera con su propia solución**.
 */

const LECCIONES = ['node-01-modulos', 'node-02-asincronia', 'node-03-servidor-http'] as const;

async function waitForEditor(page: Page) {
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await expect(page.locator('.view-lines')).not.toBeEmpty({ timeout: 20_000 });
}

const consola = (page: Page) => page.getByRole('log', { name: /consola/i });

/** Escribe una solución que puede tocar varios archivos. */
async function aplicar(page: Page, archivos: Array<{ path: string; content: string }>) {
  for (const archivo of archivos) {
    await abrirArchivo(page, archivo.path);
    await escribirEnEditor(page, archivo.content);
  }
}

test('⭐ require de un paquete de npm dice que aquí no hay npm', async ({ page }) => {
  await page.goto('/es/play/backend/node-01-modulos');
  await waitForEditor(page);

  await escribirEnEditor(page, "const express = require('express');\nconsole.log(express);\n");
  await page.getByRole('button', { name: /ejecutar/i }).click();

  /*
   * Lo importante no es que falle: es que diga **por qué** y qué sí hay. Un
   * «undefined is not a function» tres líneas más abajo no enseña nada.
   */
  await expect(consola(page)).toContainText('Aquí no hay npm', { timeout: 30_000 });
  await expect(consola(page)).toContainText('events');
});

test('⭐ el bucle de eventos ordena como en Node, no como en el archivo', async ({ page }) => {
  await page.goto('/es/play/backend/node-02-asincronia');
  await waitForEditor(page);

  await escribirEnEditor(
    page,
    "console.log('sincrono');\nsetTimeout(() => console.log('timeout'), 0);\nPromise.resolve().then(() => console.log('promesa'));\nprocess.nextTick(() => console.log('tick'));\n",
  );
  await page.getByRole('button', { name: /ejecutar/i }).click();

  // El orden es el de las colas, no el de las líneas.
  await expect(consola(page)).toContainText('sincrono', { timeout: 30_000 });
  await expect(consola(page)).toContainText('timeout');

  const salida = await consola(page).innerText();
  const orden = ['sincrono', 'tick', 'promesa', 'timeout'].map((t) => salida.indexOf(t));
  expect(orden, `el orden real fue distinto: ${JSON.stringify(salida)}`).toEqual(
    [...orden].sort((a, b) => a - b),
  );
});

test('⭐ un servidor sin red contesta las peticiones que declara la lección', async ({ page }) => {
  await page.goto('/es/play/backend/node-03-servidor-http');
  await waitForEditor(page);

  await escribirEnEditor(
    page,
    "const http = require('http');\nhttp.createServer((req, res) => {\n  res.writeHead(418, { 'Content-Type': 'text/plain' });\n  res.end('soy una tetera');\n}).listen(3000);\n",
  );
  await page.getByRole('button', { name: /ejecutar/i }).click();

  // El 418 no está en ningún enunciado: solo puede salir de ejecutar el código.
  await expect(consola(page)).toContainText('GET / -> 418 soy una tetera', { timeout: 30_000 });
  await expect(consola(page)).toContainText('POST /api/usuarios -> 418 soy una tetera');
});

for (const leccion of LECCIONES) {
  test(`⭐ ${leccion}: cada paso se supera con su solución`, async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto(`/es/play/backend/${leccion}`);
    await waitForEditor(page);

    for (let paso = 0; paso < 3; paso++) {
      /*
       * Los archivos que no son el del paso se escriben ANTES de avanzar.
       *
       * Cambiar de archivo dentro de un paso obliga al editor a cambiar de
       * modelo, y en ese hueco el pegado se le atribuye al anterior. Es una
       * limitación del test —una persona no escribe en dos archivos en el
       * mismo segundo— y no del producto: escribiendo cada archivo con la
       * pantalla quieta, la lección se supera igual.
       */
      const archivos = solucionDelPaso(leccion, paso);
      const [principal, ...secundarios] = [...archivos].reverse();
      await aplicar(page, secundarios.reverse());
      await aplicar(page, [principal]);
      await page.getByRole('button', { name: /^evaluar$/i }).click();

      await expect(
        page.getByText(/todas las pruebas superadas/i),
        `el paso ${paso + 1} de ${leccion} no pasa con su propia solución`,
      ).toBeVisible({ timeout: 60_000 });

      if (paso < 2) await avanzarPaso(page, paso + 2, 3);
    }
  });
}

test('⭐ el módulo de Node aparece en la ruta de Backend', async ({ page }) => {
  await page.goto('/es/tracks/backend');
  await expect(page.getByRole('heading', { name: 'node' })).toBeVisible();
});
