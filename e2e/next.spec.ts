import { expect, test, type Page } from '@playwright/test';
import { escribirEnEditor } from './pasos';

/**
 * Next.js: el árbol de archivos como router (ADR-27).
 *
 * Aquí no se ejecuta Next —WebContainers sigue bloqueado por licencia—, y no
 * hace falta para lo que estas lecciones enseñan: el App Router se aprende
 * leyendo el árbol y los errores que da cuando no cumples sus convenciones.
 * Eso es lo que se comprueba: que las rutas salen de las carpetas y que los
 * errores llegan con el texto que uno acabará pegando en un buscador.
 */

const LECCION = '/es/play/frontend/next-01-app-router';

async function esperarTerminal(page: Page) {
  await page.waitForSelector('.xterm-rows', { timeout: 30_000 });
  await page.waitForTimeout(800);
}

async function ejecutar(page: Page, comando: string) {
  await page.locator('.xterm').click();
  await page.keyboard.type(comando);
  await page.keyboard.press('Enter');
}

const terminal = (page: Page) => page.locator('.xterm-rows');

test('⭐ sin layout raíz, el build falla con el error de Next', async ({ page }) => {
  await page.goto(LECCION);
  await esperarTerminal(page);

  await ejecutar(page, 'next build');

  // El texto importa: es lo que se busca a las once de la noche.
  await expect(terminal(page)).toContainText('root layout', { timeout: 20_000 });
  await expect(terminal(page)).toContainText('app/layout');
});

test('⭐ crear el layout desde la interfaz deja el build en verde', async ({ page }) => {
  await page.goto(LECCION);
  await esperarTerminal(page);

  /*
   * Crear archivos era imposible hasta ahora: `allowCreate` estaba en el
   * schema desde la primera fase y no lo implementaba ninguna pantalla. En
   * Next **crear archivos es el ejercicio**, así que esto prueba la lección y
   * la herramienta a la vez.
   */
  await page.getByRole('button', { name: /nuevo archivo/i }).click();
  await page.getByLabel(/nuevo archivo/i).fill('app/layout.tsx');
  await page.getByRole('button', { name: /^crear$/i }).click();

  await expect(page.getByRole('heading', { name: 'app/layout.tsx' })).toBeVisible();

  await escribirEnEditor(
    page,
    'export default function RootLayout({ children }) {\n  return (\n    <html lang="es">\n      <body>{children}</body>\n    </html>\n  );\n}\n',
  );

  await ejecutar(page, 'next build');

  await expect(terminal(page)).toContainText('Compiled successfully', { timeout: 20_000 });
  await expect(terminal(page)).toContainText('Route (app)');
});

test('⭐ una carpeta entre paréntesis no aparece en la URL', async ({ page }) => {
  await page.goto(LECCION);
  await esperarTerminal(page);

  for (const [ruta, contenido] of [
    ['app/layout.tsx', 'export default function RootLayout({ children }) {\n  return <html><body>{children}</body></html>;\n}\n'],
    ['app/(marketing)/precios/page.tsx', 'export default function Page() {\n  return <h1>Precios</h1>;\n}\n'],
  ]) {
    await page.getByRole('button', { name: /nuevo archivo/i }).click();
    await page.getByLabel(/nuevo archivo/i).fill(ruta);
    await page.getByRole('button', { name: /^crear$/i }).click();
    await expect(page.getByRole('heading', { name: ruta })).toBeVisible();
    await escribirEnEditor(page, contenido);
  }

  await ejecutar(page, 'next build');

  // `/precios`, no `/(marketing)/precios`: el paréntesis agrupa y desaparece.
  await expect(terminal(page)).toContainText('/precios', { timeout: 20_000 });
  await expect(terminal(page)).not.toContainText('(marketing)/precios');
});

test('⭐ el módulo de Next aparece en la ruta de Frontend', async ({ page }) => {
  await page.goto('/es/tracks/frontend');
  await expect(page.getByRole('heading', { name: 'nextjs' })).toBeVisible();
});
