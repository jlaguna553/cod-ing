import { expect, test, type Page } from '@playwright/test';
import { abrirArchivo, avanzarPaso, escribirEnEditor, solucionDelPaso } from './pasos';

/**
 * El módulo de observabilidad, jugado.
 *
 * La observabilidad **de la plataforma** se prueba en `observabilidad.spec.ts`
 * —logs, `/api/health`, telemetría—. Esto es lo otro: el capítulo que la
 * enseña. Corrige por salida (`"p95":950`, `"requestId":"req-2"`), así que
 * `tests/observabilidad-lecciones.test.ts` ya comprueba las cifras contra el
 * runtime; aquí se comprueba que el camino completo funciona en la pantalla.
 */

const LECCIONES = [
  'obs-01-logs-estructurados',
  'obs-02-seguir-una-peticion',
  'obs-03-metricas-y-percentiles',
] as const;

async function waitForEditor(page: Page) {
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await expect(page.locator('.view-lines')).not.toBeEmpty({ timeout: 20_000 });
}

const consola = (page: Page) => page.getByRole('log', { name: /consola/i });

async function aplicar(page: Page, archivos: Array<{ path: string; content: string }>) {
  for (const archivo of archivos) {
    await abrirArchivo(page, archivo.path);
    await escribirEnEditor(page, archivo.content);
  }
}

test('⭐ la media esconde la cola: el p95 no se parece a la media', async ({ page }) => {
  await page.goto('/es/play/devops/obs-03-metricas-y-percentiles');
  await waitForEditor(page);

  await escribirEnEditor(
    page,
    "const peticiones = require('./peticiones');\nconst ms = peticiones.map((p) => p.ms).sort((a, b) => a - b);\nconsole.log('media', Math.round(ms.reduce((a, b) => a + b, 0) / ms.length));\nconsole.log('p50', ms[Math.ceil(0.5 * ms.length) - 1]);\nconsole.log('p95', ms[Math.ceil(0.95 * ms.length) - 1]);\n",
  );
  await page.getByRole('button', { name: /ejecutar/i }).click();

  // La afirmación entera de la lección, en tres cifras.
  await expect(consola(page)).toContainText('media 143', { timeout: 30_000 });
  await expect(consola(page)).toContainText('p50 51');
  await expect(consola(page)).toContainText('p95 950');
});

for (const leccion of LECCIONES) {
  test(`⭐ ${leccion}: cada paso se supera con su solución`, async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto(`/es/play/devops/${leccion}`);
    await waitForEditor(page);

    for (let paso = 0; paso < 3; paso++) {
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

test('⭐ el capítulo de observabilidad aparece en la ruta de DevOps', async ({ page }) => {
  await page.goto('/es/tracks/devops');
  await expect(page.getByRole('heading', { name: 'observability' })).toBeVisible();
});
