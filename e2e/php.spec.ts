import { expect, test, type Page } from '@playwright/test';
import { resolverPaso, escribirEnEditor } from './pasos';

/**
 * PHP en el navegador (ADR-20).
 *
 * Lo que se prueba aquí no es que la lección se pinte: es que **el intérprete
 * ejecuta de verdad** el código que se escribe, que la salida sale por la
 * terminal, y que un error de PHP se enseña con su texto y en la línea del
 * usuario — no en la del prelude, que va delante y no ha escrito nadie.
 */

const LECCION = '/es/play/backend/php-01-echo-variables';
const ARRANQUE = 40_000;

async function waitForEditor(page: Page) {
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await expect(page.locator('.view-lines')).not.toBeEmpty({ timeout: 20_000 });
}

/**
 * La salida de PHP es texto: sale por la consola, no por una terminal.
 *
 * En una lección sin vista previa la consola es el panel entero, así que no
 * hay pestaña que pulsar — pero se pulsa si existe, para que el helper valga
 * también en las que sí la tienen.
 */
async function consola(page: Page) {
  const pestana = page.getByRole('button', { name: /consola/i });
  if ((await pestana.count()) > 0) await pestana.click();
  return page.getByRole('log', { name: /consola/i });
}

test('⭐ el intérprete arranca y ejecuta el código que se escribe', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);

  await escribirEnEditor(page, "<?php\n$x = 6 * 7;\necho \"La respuesta es $x.\";\n");
  await page.getByRole('button', { name: /ejecutar/i }).click();

  // 42 no está en ninguna parte del enunciado: solo puede salir de ejecutar.
  await expect(await consola(page)).toContainText('La respuesta es 42.', { timeout: ARRANQUE });
});

test('⭐ un error de PHP se enseña tal cual, y en la línea del usuario', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);

  // Falta el punto y coma de la primera línea.
  await escribirEnEditor(page, "<?php\n$x = 1\necho $x;\n");
  await page.getByRole('button', { name: /ejecutar/i }).click();

  const salida = await consola(page);
  await expect(salida).toContainText(/Parse error/i, { timeout: ARRANQUE });

  /*
   * La línea es la del ejercicio, no la del prelude.
   *
   * El prelude son casi doscientas líneas que se anteponen al código; sin
   * renumerar, este error se reportaría en la 190 y el número no serviría
   * para nada. Se acepta 2 o 3 porque PHP señala dónde se da cuenta, no
   * dónde falta el punto y coma.
   */
  await expect(salida).toContainText(/on line [23]\b/, { timeout: 10_000 });
});

test('⭐ la biblioteca que rellena el prelude está disponible para el usuario', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);

  await escribirEnEditor(
    page,
    "<?php\n$n = [3, 1, 2];\nsort($n);\necho implode(',', $n), ' y ', number_format(1234.567, 2);\n",
  );
  await page.getByRole('button', { name: /ejecutar/i }).click();

  await expect(await consola(page)).toContainText('1,2,3 y 1234.57', { timeout: ARRANQUE });
});

test('⭐ el flujo completo de php-01 termina en verde', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(LECCION);
  await waitForEditor(page);

  await resolverPaso(page, 'php-01-echo-variables', 0);
  await resolverPaso(page, 'php-01-echo-variables', 1);

  // Último paso: no hay «Siguiente», hay lección superada.
  await escribirEnEditor(
    page,
    "<?php\n$precio = 49;\n$total = $precio * 1.21;\necho 'Total con IVA: ' . number_format($total, 2) . ' euros.';\n",
  );
  await page.getByRole('button', { name: /^evaluar$/i }).click();
  await expect(page.getByText(/todas las pruebas superadas/i)).toBeVisible({ timeout: 30_000 });
});

test('⭐ php-03: las dos llamadas usan el valor por defecto', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/es/play/backend/php-03-funciones');
  await waitForEditor(page);

  await resolverPaso(page, 'php-03-funciones', 0);

  await escribirEnEditor(
    page,
    "<?php\n\nfunction dosPorUno($nombre = 'ti')\n{\n    return \"Uno para $nombre, uno para mí.\";\n}\n\necho dosPorUno('Ada'), PHP_EOL;\necho dosPorUno();\n",
  );
  await page.getByRole('button', { name: /^evaluar$/i }).click();

  await expect(await consola(page)).toContainText('Uno para ti, uno para mí.', { timeout: ARRANQUE });
  await expect(page.getByRole('button', { name: /^siguiente$/i })).toBeVisible({ timeout: 30_000 });
});

test('⭐ el track de Backend ofrece ya tres tecnologías', async ({ page }) => {
  await page.goto('/es/tracks/backend');
  await expect(page.getByRole('heading', { name: 'php' })).toBeVisible();
});
