import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Las lecciones de CSS afirman colores computados concretos. Eso solo se puede
 * comprobar en un navegador con layout de verdad, ejecutando las soluciones
 * REALES del JSON: si alguien las cambia y dejan de producir esos colores, el
 * enunciado del paso pasa a ser mentira.
 */

async function waitForEditor(page: Page) {
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await expect(page.locator('.view-lines')).not.toBeEmpty({ timeout: 20_000 });
}

test('⭐ css-01: la especificidad decide los colores que la lección promete', async ({ page }) => {
  test.setTimeout(180_000);

  const lesson = JSON.parse(
    readFileSync('content/lessons/frontend/css/css-01-selectors.lesson.json', 'utf8'),
  ) as { steps: Array<{ id: string; solution?: Array<{ path: string; content: string }> }> };
  const cssOf = (id: string) =>
    lesson.steps.find((step) => step.id === id)?.solution?.[0]?.content ?? '';

  await page.goto('/es/play/frontend/css-01-selectors');
  await waitForEditor(page);

  const colores = () =>
    page.evaluate(() => {
      const mirror = Array.from(document.querySelectorAll('iframe')).find(
        (frame) => frame.getAttribute('sandbox') === 'allow-same-origin',
      );
      const doc = mirror?.contentDocument;
      const leer = (selector: string) => {
        const node = doc?.querySelector(selector);
        return node ? doc!.defaultView!.getComputedStyle(node).color : '';
      };
      return { inicio: leer('.inicio'), oferta: leer('.oferta'), ayuda: leer('.ayuda') };
    });

  const aplicar = async (css: string) => {
    await page.locator('.monaco-editor').click({ position: { x: 100, y: 40 } });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await page.evaluate(async (text) => navigator.clipboard.writeText(text), css);
    await page.keyboard.press('ControlOrMeta+v');
    await page.getByRole('button', { name: /ejecutar/i }).click();
  };

  // Paso 1: la regla está escrita y NO gana — ese es el descubrimiento.
  await aplicar(cssOf('step-1-base'));
  await expect.poll(colores, { timeout: 60_000 }).toMatchObject({ inicio: 'rgb(56, 189, 248)' });

  // Paso 2: al bajar el id, gana la clase; y `.destacado` gana por orden.
  await aplicar(cssOf('step-2-lower'));
  await expect
    .poll(colores, { timeout: 60_000 })
    .toMatchObject({ inicio: 'rgb(148, 163, 184)', oferta: 'rgb(245, 158, 11)' });

  // Paso 3: dos clases empatadas, decide la última de la hoja.
  await aplicar(cssOf('step-3-order'));
  await expect.poll(colores, { timeout: 60_000 }).toMatchObject({
    inicio: 'rgb(148, 163, 184)',
    oferta: 'rgb(245, 158, 11)',
    ayuda: 'rgb(71, 85, 105)',
  });
});

test('⭐ html-03: el formulario pasa de decorativo a usable', async ({ page }) => {
  test.setTimeout(180_000);

  const lesson = JSON.parse(
    readFileSync('content/lessons/frontend/html/html-03-forms.lesson.json', 'utf8'),
  ) as { steps: Array<{ id: string; solution?: Array<{ path: string; content: string }> }> };

  await page.goto('/es/play/frontend/html-03-forms');
  await waitForEditor(page);

  const formulario = () =>
    page.evaluate(() => {
      const mirror = Array.from(document.querySelectorAll('iframe')).find(
        (frame) => frame.getAttribute('sandbox') === 'allow-same-origin',
      );
      const doc = mirror?.contentDocument;
      const correo = doc?.querySelector('#correo') as HTMLInputElement | null;
      return {
        labels: doc?.querySelectorAll('label').length ?? -1,
        tipoCorreo: correo?.getAttribute('type') ?? '',
        // El nombre accesible: lo que un lector de pantalla anunciaría.
        etiquetado: Boolean(doc?.querySelector("label[for='correo']")),
        botones: doc?.querySelectorAll("button[type='submit']").length ?? -1,
        divBoton: doc?.querySelectorAll('div[onclick]').length ?? -1,
      };
    });

  const aplicar = async (html: string) => {
    await page.locator('.monaco-editor').click({ position: { x: 100, y: 40 } });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await page.evaluate(async (text) => navigator.clipboard.writeText(text), html);
    await page.keyboard.press('ControlOrMeta+v');
    await page.getByRole('button', { name: /ejecutar/i }).click();
  };

  const solucionDe = (id: string) =>
    lesson.steps.find((step) => step.id === id)?.solution?.[0]?.content ?? '';

  await aplicar(solucionDe('step-1-labels'));
  await expect.poll(formulario, { timeout: 60_000 }).toMatchObject({ labels: 2, etiquetado: true });

  await aplicar(solucionDe('step-2-types'));
  await expect.poll(formulario, { timeout: 60_000 }).toMatchObject({ tipoCorreo: 'email' });

  await aplicar(solucionDe('step-3-button'));
  await expect
    .poll(formulario, { timeout: 60_000 })
    .toMatchObject({ botones: 1, divBoton: 0, labels: 2, tipoCorreo: 'email' });
});
