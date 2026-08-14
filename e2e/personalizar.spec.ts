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

test('⭐ soltar una tarjeta sobre otra las intercambia, y no se solapan', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);
  await page.getByRole('button', { name: /personalizar/i }).click();

  const izquierda = zona(page, 'left');
  const idsDe = () =>
    izquierda.locator('[data-widget]').evaluateAll((n) => n.map((x) => x.getAttribute('data-widget')));

  const antes = await idsDe();
  await izquierda
    .locator(`[data-widget="${antes[0]}"] [aria-label*="Arrastrar"]`)
    .dragTo(izquierda.locator(`[data-widget="${antes[2]}"]`));

  const despues = await idsDe();
  // Se cambian de sitio las dos; el resto se queda donde estaba.
  expect(despues[0]).toBe(antes[2]);
  expect(despues[2]).toBe(antes[0]);
  expect(despues[1]).toBe(antes[1]);
  expect(despues).toHaveLength(antes.length);

  // Y lo que motivó el cambio: ninguna tarjeta pisa a la siguiente.
  const cajas = await izquierda
    .locator('[data-widget]')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
      }),
    );
  for (let i = 1; i < cajas.length; i += 1) {
    expect(cajas[i].top, 'una tarjeta se dibuja encima de la siguiente').toBeGreaterThanOrEqual(
      cajas[i - 1].bottom - 1,
    );
  }
});

test('⭐ cada tarjeta se redimensiona de alto, y el alto persiste', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);

  const tarjeta = zona(page, 'left').locator('[data-widget="files"]');
  const alto = () => tarjeta.evaluate((node) => Math.round(node.getBoundingClientRect().height));
  const inicial = await alto();

  // Con el teclado, igual que las columnas.
  await page.getByRole('separator', { name: /alto de archivos/i }).focus();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowDown');

  await expect.poll(alto).not.toBe(inicial);
  const ajustado = await alto();

  await page.reload();
  await waitForEditor(page);
  await expect.poll(alto).toBe(ajustado);
});

test('⭐ la franja fija de la derecha también se redimensiona', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);

  const franja = () =>
    zona(page, 'dock').evaluate((node) =>
      Math.round(node.parentElement!.getBoundingClientRect().height),
    );
  const inicial = await franja();

  await page.getByRole('separator', { name: /alto de la franja fija/i }).focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowUp');

  await expect.poll(franja).toBeGreaterThan(inicial);
});

test('⭐ todos los divisores se pueden ver y agarrar con el ratón', async ({ page }) => {
  /*
   * La comprobación que faltaba.
   *
   * Los tests de redimensionar usaban `focus()` y flechas, así que pasaban con
   * un divisor de CERO píxeles: se podía enfocar con Tab y no había nada donde
   * pinchar. Medir la caja es lo único que distingue «existe en el DOM» de
   * «existe en la pantalla».
   */
  await page.goto(LECCION);
  await waitForEditor(page);

  const divisores = page.getByRole('separator');
  const total = await divisores.count();
  expect(total, 'debería haber divisores de columna, de editor y de tarjeta').toBeGreaterThan(3);

  for (let i = 0; i < total; i += 1) {
    const divisor = divisores.nth(i);
    const etiqueta = (await divisor.getAttribute('aria-label')) ?? `#${i}`;
    const caja = await divisor.boundingBox();

    expect(caja, `«${etiqueta}» no se renderiza`).not.toBeNull();
    expect(caja!.width, `«${etiqueta}» no tiene ancho que agarrar`).toBeGreaterThanOrEqual(2);
    expect(caja!.height, `«${etiqueta}» no tiene alto que agarrar`).toBeGreaterThanOrEqual(2);
  }
});

test('⭐ el ancho se cambia arrastrando, no solo con el teclado', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);

  const columna = page.locator('[data-zone="left"]').locator('xpath=..');
  const ancho = () => columna.evaluate((node) => Math.round(node.getBoundingClientRect().width));
  const inicial = await ancho();

  const divisor = page.getByRole('separator', { name: /ancho de la columna izquierda/i });
  const caja = (await divisor.boundingBox())!;

  await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
  await page.mouse.down();
  await page.mouse.move(caja.x + caja.width / 2 + 90, caja.y + caja.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect.poll(ancho).toBeGreaterThan(inicial + 40);
});

test('⭐ la columna derecha crece hacia la izquierda, quitándole sitio al centro', async ({
  page,
}) => {
  /*
   * El síntoma era desconcertante: hacia la derecha encogía y hacia la
   * izquierda no pasaba nada. El ancho SÍ crecía en el store —de 400 a 550—
   * pero el centro se negaba a ceder por su `min-width: auto`, así que la
   * columna se salía por el borde en vez de ensancharse.
   *
   * Por eso el test mide las dos: que una crezca sin que la otra encoja no es
   * redimensionar, es desbordar.
   */
  await page.goto(LECCION);
  await waitForEditor(page);

  const medir = () =>
    page.evaluate(() => {
      const derecha = document.querySelector('[data-zone="dock"]')!.closest('aside')!;
      const centro = document.querySelector('main')!;
      return {
        derecha: Math.round(derecha.getBoundingClientRect().width),
        centro: Math.round(centro.getBoundingClientRect().width),
      };
    });

  const antes = await medir();

  const divisor = (await page
    .getByRole('separator', { name: /ancho de la columna derecha/i })
    .boundingBox())!;
  await page.mouse.move(divisor.x + divisor.width / 2, divisor.y + divisor.height / 2);
  await page.mouse.down();
  await page.mouse.move(divisor.x + divisor.width / 2 - 120, divisor.y + divisor.height / 2, {
    steps: 12,
  });
  await page.mouse.up();

  const despues = await medir();
  expect(despues.derecha, 'la derecha no se ensanchó').toBeGreaterThan(antes.derecha + 60);
  expect(despues.centro, 'el centro no cedió sitio: se está desbordando').toBeLessThan(
    antes.centro - 60,
  );
});
