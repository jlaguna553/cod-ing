import { expect, test, type Page } from '@playwright/test';
import { THEMES } from '../src/stores/useLayoutStore';

/**
 * Las paletas.
 *
 * Lo que se comprueba no es que el atributo cambie —eso es trivial— sino que
 * **los colores que se ven cambien de verdad**, que persistan y que el texto
 * siga siendo legible sobre su fondo en todas. Una paleta bonita que no se
 * puede leer no es una opción, es un adorno.
 */

const LECCION = '/es/play/frontend/css-01-selectors';

async function waitForEditor(page: Page) {
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
}

/** Luminancia relativa (WCAG) de un color `rgb(...)`. */
function luminancia(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+/g) ?? ['0', '0', '0']).map(Number).map((canal) => {
    const s = canal / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

const colores = (page: Page) =>
  page.evaluate(() => {
    const estilo = getComputedStyle(document.body);
    return { fondo: estilo.backgroundColor, texto: estilo.color };
  });

test('⭐ cambiar de tema cambia los colores que se ven', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);

  const antes = await colores(page);
  await page.getByLabel(/^tema$/i).selectOption('paper');

  await expect.poll(() => colores(page)).not.toEqual(antes);
  const despues = await colores(page);

  // La clara es clara de verdad: no es la oscura con otro acento.
  expect(luminancia(despues.fondo)).toBeGreaterThan(luminancia(antes.fondo) + 0.5);
});

test('⭐ el tema sobrevive a la recarga y llega sin destello', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);
  await page.getByLabel(/^tema$/i).selectOption('matrix');
  const elegido = await colores(page);

  await page.reload();

  /*
   * Se mira el atributo ANTES de esperar a nada: lo pone un script síncrono
   * del `<head>`, así que ya tiene que estar en el primer pintado. Si se
   * aplicara desde React, aquí habría un destello con la paleta anterior.
   */
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'matrix');
  await waitForEditor(page);
  expect(await colores(page)).toEqual(elegido);
});

test('⭐ en todas las paletas el texto se lee sobre su fondo', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);

  for (const tema of THEMES) {
    await page.getByLabel(/^tema$/i).selectOption(tema);
    await expect(page.locator('html')).toHaveAttribute('data-theme', tema);

    const { fondo, texto } = await colores(page);
    const ratio = contraste(texto, fondo);
    // 4.5:1 es el mínimo de la norma para texto normal.
    expect(ratio, `«${tema}»: contraste ${ratio.toFixed(1)}:1, ilegible`).toBeGreaterThanOrEqual(
      4.5,
    );
  }
});

test('⭐ el editor también sigue la paleta, no se queda oscuro', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);

  /*
   * Monaco pinta con su propio tema, no con las variables CSS. Con la paleta
   * clara la página se aclaraba entera y el editor se quedaba como un rectángulo
   * negro en medio: lo más grande de la pantalla era lo único que no cambiaba.
   * Aquí se mide su fondo real, que es lo que se ve.
   */
  const fondoEditor = () =>
    page.locator('.monaco-editor .monaco-editor-background').first().evaluate(
      (nodo) => getComputedStyle(nodo).backgroundColor,
    );

  await page.getByLabel(/^tema$/i).selectOption('paper');
  await expect.poll(() => fondoEditor().then(luminancia)).toBeGreaterThan(0.5);

  await page.getByLabel(/^tema$/i).selectOption('matrix');
  await expect.poll(() => fondoEditor().then(luminancia)).toBeLessThan(0.1);
});

test('⭐ restablecer la disposición NO cambia la paleta', async ({ page }) => {
  await page.goto(LECCION);
  await waitForEditor(page);
  await page.getByLabel(/^tema$/i).selectOption('amber');

  await page.getByRole('button', { name: /personalizar/i }).click();
  await page.getByRole('button', { name: /restablecer/i }).click();

  // Son dos preferencias distintas: recolocar tarjetas no toca los colores.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'amber');
});
