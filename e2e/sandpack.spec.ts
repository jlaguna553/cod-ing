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

const SOLUCION = `function WelcomeCard() {
  return <p>Bienvenida a la partida</p>;
}

function ScoreBadge() {
  return <span>0 puntos</span>;
}

export default function App() {
  return (
    <div>
      <WelcomeCard />
      <ScoreBadge />
    </div>
  );
}
`;

test('⭐ una lección de React compila y su regla dom-assert se evalúa', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/es/play/frontend/react-01-components');
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });

  /*
   * Se pega desde el portapapeles, no con `insertText`.
   *
   * `insertText` dispara el autocierre de Monaco y dejaba una llave suelta al
   * final: el sandbox recibía un `SyntaxError` real y no renderizaba. Costó un
   * diagnóstico entero — parecía un fallo del bundler y era del test.
   */
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.evaluate(async (code) => navigator.clipboard.writeText(code), SOLUCION);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('.view-lines')).toContainText('ScoreBadge');

  await page.getByRole('button', { name: /ejecutar/i }).click();

  // Que llegue texto prueba las dos cosas: si no compilara no habría nada, y
  // si el espejo no funcionara no lo veríamos.
  await expect.poll(() => mirrorText(page), { timeout: 90_000 }).toContain('Bienvenida');

  // Y `renders-text` deja de estar pendiente: se pone verde.
  await page.getByRole('button', { name: /validar paso/i }).click();
  await expect(page.getByText(/todas las pruebas superadas/i)).toBeVisible({ timeout: 30_000 });
});
