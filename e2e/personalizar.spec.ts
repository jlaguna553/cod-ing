import { expect, test, type Page } from '@playwright/test';

/**
 * La pantalla personalizable.
 *
 * Lo que se prueba es que las decisiones del usuario **se apliquen y
 * sobrevivan**: ocultar, mover de columna, reordenar y redimensionar tienen que
 * seguir ahí tras recargar, porque una preferencia que se olvida es peor que no
 * ofrecerla.
 */

const LECCION = '/es/play/frontend/js-01-variables';

async function waitForEditor(page: Page) {
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
}

const zona = (page: Page, nombre: string) => page.locator(`[data-zone="${nombre}"]`);

test('⭐ hay salida: se vuelve al mapa de la ruta', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);

  await page.getByRole('link', { name: /volver a la ruta/i }).click();
  await expect(page).toHaveURL(/\/es\/tracks\/frontend/);
  await expect(page.getByRole('heading', { name: /frontend/i }).first()).toBeVisible();
});

test('⭐ ocultar una tarjeta la quita, y la bandeja la devuelve', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);
  await expect(zona(page, 'left').getByRole('heading', { name: /archivos/i })).toBeVisible();

  await page.getByRole('button', { name: /personalizar/i }).click();
  await page.getByRole('button', { name: /ocultar archivos/i }).click();
  await expect(zona(page, 'left').getByRole('heading', { name: /archivos/i })).toHaveCount(0);

  // Ocultar sin forma evidente de recuperar sería una trampa: está en la bandeja.
  await page.getByRole('button', { name: /^archivos$/i }).click();
  await expect(zona(page, 'left').getByRole('heading', { name: /archivos/i })).toBeVisible();
});

test('⭐ una tarjeta cambia de columna y se queda ahí tras recargar', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);

  await page.getByRole('button', { name: /personalizar/i }).click();

  // Se arrastra «Archivos» de la izquierda a la franja fija de la derecha.
  const origen = zona(page, 'left').locator('[data-widget="files"] [aria-label*="Arrastrar"]');
  await origen.dragTo(zona(page, 'dock'));

  await expect(zona(page, 'dock').locator('[data-widget="files"]')).toHaveCount(1);
  await expect(zona(page, 'left').locator('[data-widget="files"]')).toHaveCount(0);

  await page.reload();
  await waitForEditor(page);
  await expect(zona(page, 'dock').getByRole('heading', { name: /archivos/i })).toBeVisible();
});

test('⭐ reordenar con los botones funciona sin ratón', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);
  await page.getByRole('button', { name: /personalizar/i }).click();

  const ordenActual = () =>
    zona(page, 'left')
      .locator('[data-widget]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-widget')));

  const antes = await ordenActual();
  await page.getByRole('button', { name: new RegExp(`subir`, 'i') }).nth(1).click();
  const despues = await ordenActual();

  expect(despues).not.toEqual(antes);
  expect(despues[0]).toBe(antes[1]);
});

test('⭐ la columna se redimensiona y el ancho persiste', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);

  const ancho = () =>
    zona(page, 'left').evaluate((node) => Math.round(node.parentElement!.getBoundingClientRect().width));
  const inicial = await ancho();

  // Con el teclado: redimensionar tiene que ser posible sin ratón.
  await page.getByRole('separator', { name: /ancho de la columna izquierda/i }).focus();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');

  await expect.poll(ancho).toBeGreaterThan(inicial);
  const ensanchada = await ancho();

  await page.reload();
  await waitForEditor(page);
  await expect.poll(ancho).toBe(ensanchada);
});

test('⭐ restablecer devuelve la disposición de fábrica', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);
  await page.getByRole('button', { name: /personalizar/i }).click();

  await page.getByRole('button', { name: /ocultar archivos/i }).click();
  await expect(zona(page, 'left').locator('[data-widget="files"]')).toHaveCount(0);

  await page.getByRole('button', { name: /restablecer/i }).click();
  await expect(zona(page, 'left').locator('[data-widget="files"]')).toHaveCount(1);
});
