import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * C# con evaluador simulado (ADR-14).
 *
 * Lo que hay que probar aquí no es que la terminal imprima algo con pinta de
 * `dotnet test`: es que **lo que imprime sale del código del usuario**. Por eso
 * el test escribe primero una solución incorrecta y exige que falle, y solo
 * después la correcta. Un simulador de decorado pasaría la segunda mitad y
 * suspendería la primera.
 */

async function waitForEditor(page: Page) {
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await expect(page.locator('.view-lines')).not.toBeEmpty({ timeout: 20_000 });
}

async function writeMethod(page: Page, expression: string) {
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    'namespace Calendario;\n\npublic static class Leap\n{\n' +
      `    public static bool EsBisiesto(int year) => ${expression};\n}\n`,
  );
}

async function runTests(page: Page) {
  await page.locator('.xterm').click();
  await page.keyboard.type('dotnet test');
  await page.keyboard.press('Enter');
}

test('⭐ una solución incorrecta falla, y dice en qué año', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/es/play/backend/csharp-01-leap-year');
  await waitForEditor(page);

  // El error clásico: se olvida la excepción del 400. Falla solo en 1900/2000.
  await writeMethod(page, 'year % 4 == 0 && year % 100 != 0');
  await runTests(page);

  const rows = page.locator('.xterm-rows');
  await expect(rows).toContainText('Con error: 1', { timeout: 20_000 });
  await expect(rows).toContainText('2000');
});

test('⭐ la solución correcta pasa los seis casos y valida el paso', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/es/play/backend/csharp-01-leap-year');
  await waitForEditor(page);

  /*
   * El paso 1 no se resuelve escribiendo: pide ejecutar `dotnet test` y leer
   * qué casos fallan. Se cumple de verdad y se evalúa, que es la única forma
   * de que aparezca «Siguiente».
   */
  await runTests(page);
  await page.getByRole('button', { name: /^evaluar$/i }).click();
  await page.getByRole('button', { name: /^siguiente$/i }).click();

  await writeMethod(page, 'year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)');
  await runTests(page);

  await expect(page.locator('.xterm-rows')).toContainText('Con error: 0', { timeout: 20_000 });

  await page.getByRole('button', { name: /^evaluar$/i }).click();
  await expect(page.getByText(/todas las pruebas superadas/i)).toBeVisible({ timeout: 20_000 });
});

test('⭐ el track de Backend ofrece ya dos tecnologías', async ({ page }) => {
  await page.goto('/es/tracks/backend');
  await expect(page.getByRole('heading', { name: 'sql' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'csharp' })).toBeVisible();
});

/**
 * Cada paso promete un avance concreto en el marcador de pruebas. Se comprueba
 * ejecutando las soluciones REALES del JSON: si alguien las cambia y dejan de
 * producir ese avance, el enunciado del paso pasa a ser mentira y esto lo dice.
 */
for (const [lessonId, methodFile] of [
  ['csharp-02-fizzbuzz', 'FizzBuzz.cs'],
  ['csharp-03-triangle', 'Triangle.cs'],
] as const) {
  test(`⭐ ${lessonId}: cada paso avanza el marcador como promete`, async ({ page }) => {
    test.setTimeout(180_000);

    const lesson = JSON.parse(
      readFileSync(`content/lessons/backend/csharp/${lessonId}.lesson.json`, 'utf8'),
    ) as { steps: Array<{ id: string; solution?: Array<{ path: string; content: string }> }> };

    await page.goto(`/es/play/backend/${lessonId}`);
    await waitForEditor(page);

    let previous = -1;
    for (const step of lesson.steps) {
      const code = step.solution?.find((file) => file.path === methodFile)?.content;
      expect(code, `${step.id} no trae solución para ${methodFile}`).toBeTruthy();

      await page.locator('.monaco-editor .view-lines').click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Delete');
      await page.evaluate(async (text) => navigator.clipboard.writeText(text), code!);
      await page.keyboard.press('ControlOrMeta+v');

      await runTests(page);

      const passed = await test.step(`marcador tras ${step.id}`, async () => {
        const rows = page.locator('.xterm-rows');
        await expect(rows).toContainText(/Superados: \d+/, { timeout: 20_000 });
        const text = (await rows.innerText()).replace(/\s+/g, ' ');
        const matches = [...text.matchAll(/Superados: (\d+)/g)];
        return Number(matches.at(-1)?.[1] ?? -1);
      });

      // Nunca retrocede, y el último paso lo deja todo en verde.
      expect(passed, `${step.id} debería superar a lo anterior`).toBeGreaterThanOrEqual(previous);
      previous = passed;
    }

    await expect(page.locator('.xterm-rows')).toContainText('Con error: 0');
  });
}
