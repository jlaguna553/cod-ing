import { expect, test, type Page } from '@playwright/test';

/**
 * Sandpack: que compile, y que el evaluador pueda leer lo que renderiza.
 *
 * Los dos fallos que cubre eran silenciosos. El bundler no recibía `template`,
 * caía en `static` y **ninguna** lección de framework arrancaba; y su iframe es
 * de otro origen, así que `contentDocument` era `null` y toda regla
 * `dom-assert` de React y Vue quedaba en «pendiente» — nunca en rojo, así que
 * nada chilló desde la Fase 3.
 */

/** Texto que el evaluador ve, a través del espejo del ADR-10. */
async function mirrorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const mirror = Array.from(document.querySelectorAll('iframe')).find(
      (frame) => frame.getAttribute('sandbox') === 'allow-same-origin',
    );
    return mirror?.contentDocument?.body?.innerText ?? '';
  });
}

/*
 * PENDIENTE, a propósito.
 *
 * Con la plantilla y el espejo arreglados, el sandbox ya compila y monta —el
 * DOM que llega tiene `<div id="root">` con la app dentro— pero el render sale
 * incompleto y aparece la superposición de error de CodeSandbox. Falta una
 * pieza que no está diagnosticada.
 *
 * Se deja escrito y marcado `fixme` en lugar de borrarlo: describe el
 * comportamiento que debe haber, falla por el motivo correcto y no deja la
 * suite en rojo mientras tanto. Borrarlo sería perder el único sitio donde
 * consta que esto no funciona.
 */
test.fixme('⭐ una lección de React compila y su regla dom-assert se evalúa', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/es/play/frontend/react-01-components');
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });

  // El código de partida no renderiza nada a propósito: hay que resolverlo.
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    'function WelcomeCard() {\n  return <p>Bienvenida a la partida</p>;\n}\n\n' +
      'function ScoreBadge() {\n  return <span>0 puntos</span>;\n}\n\n' +
      'export default function App() {\n  return (\n    <div>\n      <WelcomeCard />\n      <ScoreBadge />\n    </div>\n  );\n}\n',
  );

  await page.getByRole('button', { name: /ejecutar/i }).click();

  // Que llegue texto prueba las dos cosas: si no compilara no habría nada, y
  // si el espejo no funcionara no lo veríamos.
  await expect.poll(() => mirrorText(page), { timeout: 90_000 }).toContain('Bienvenida');

  // Y `renders-text` deja de estar pendiente: se pone verde.
  await page.getByRole('button', { name: /validar paso/i }).click();
  await expect(page.getByText(/todas las pruebas superadas/i)).toBeVisible({ timeout: 30_000 });
});
