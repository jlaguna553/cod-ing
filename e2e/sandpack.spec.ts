import { readFileSync } from 'node:fs';
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
  await page.locator('.monaco-editor').click({ position: { x: 100, y: 40 } });
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
  await page.getByRole('button', { name: /^evaluar$/i }).click();
  await expect(page.getByText(/todas las pruebas superadas/i)).toBeVisible({ timeout: 30_000 });
});

/**
 * Cada paso de `react-05` promete un DOM concreto. Se comprueba ejecutando las
 * soluciones REALES del JSON: si alguien las cambia y dejan de renderizar eso,
 * el enunciado del paso pasa a ser mentira y este test lo dice.
 */
test('⭐ react-05: los tres pasos renderizan lo que prometen', async ({ page }) => {
  test.setTimeout(240_000);

  const lesson = JSON.parse(
    readFileSync('content/lessons/frontend/react/react-05-todo-list.lesson.json', 'utf8'),
  ) as { steps: Array<{ id: string; solution?: Array<{ path: string; content: string }> }> };

  await page.goto('/es/play/frontend/react-05-todo-list');
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });

  const contar = () =>
    page.evaluate(() => {
      const mirror = Array.from(document.querySelectorAll('iframe')).find(
        (frame) => frame.getAttribute('sandbox') === 'allow-same-origin',
      );
      const doc = mirror?.contentDocument;
      return {
        tareas: doc?.querySelectorAll('li.tarea').length ?? -1,
        hechas: doc?.querySelectorAll('li.hecha').length ?? -1,
        pendientes: doc?.querySelector('.pendientes')?.textContent?.trim() ?? '',
      };
    });

  for (const step of lesson.steps) {
    const code = step.solution?.find((file) => file.path === 'src/App.jsx')?.content;
    expect(code, `${step.id} no trae solución`).toBeTruthy();

    await page.locator('.monaco-editor').click({ position: { x: 100, y: 40 } });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await page.evaluate(async (text) => navigator.clipboard.writeText(text), code!);
    await page.keyboard.press('ControlOrMeta+v');

    await page.getByRole('button', { name: /ejecutar/i }).click();

    // Los tres pasos comparten la lista; a partir del 2 aparece el recuento.
    await expect.poll(contar, { timeout: 90_000 }).toMatchObject({ tareas: 3, hechas: 1 });
    if (step.id !== 'step-1-render') {
      await expect.poll(contar).toMatchObject({ pendientes: 'Quedan 2' });
    }
  }
});
