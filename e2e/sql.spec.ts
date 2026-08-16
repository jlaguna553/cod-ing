import { expect, test, type Page } from '@playwright/test';
import { resolverPaso } from './pasos';

/**
 * El track de Backend, contra PostgreSQL de verdad en el navegador (ADR-11).
 *
 * Ningún test de Node cubre esto: `SqlRunner` carga PGlite con un `import()`
 * que el bundler no puede ver, sirviéndolo desde `/pglite/`. Si esa copia
 * falta, el bundler la reescribe o el paquete cambia de estructura, la lección
 * no arranca — y solo se ve aquí.
 */

async function waitForEditor(page: Page) {
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await expect(page.locator('.view-lines')).not.toBeEmpty({ timeout: 20_000 });
}

/** Sustituye la consulta insertando el texto de golpe (sin autocierre de Monaco). */
async function writeQuery(page: Page, sql: string) {
  await page.locator('.monaco-editor').click({ position: { x: 100, y: 40 } });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(sql);
}

/** Arrancar Postgres en WASM tarda unos segundos: no es un fallo, es el precio. */
const BOOT = 60_000;

test('⭐ PostgreSQL arranca en el navegador y devuelve filas reales', async ({ page }) => {
  await page.goto('/es/play/backend/sql-01-select');
  await waitForEditor(page);

  await page.getByRole('button', { name: /ejecutar/i }).click();

  // La rejilla, no la consola: un resultado tabular se lee en una tabla.
  const grid = page.locator('table');
  await expect(grid).toBeVisible({ timeout: BOOT });
  await expect(grid).toContainText('Teclado mecánico');
  await expect(grid).toContainText('descatalogado');
  await expect(page.getByText(/7 fila/)).toBeVisible();
});

test('⭐ el flujo completo de sql-01 termina en verde', async ({ page }) => {
  await page.goto('/es/play/backend/sql-01-select');
  await waitForEditor(page);

  // Hay que resolver el paso 1 para llegar al 2: ya no se puede saltar.
  await resolverPaso(page, 'sql-01-select', 0);
  await writeQuery(page, 'SELECT nombre, precio\nFROM productos\nWHERE precio > 80;\n');

  await page.getByRole('button', { name: /ejecutar/i }).click();
  await expect(page.locator('table')).toContainText('Monitor 27', { timeout: BOOT });

  await page.getByRole('button', { name: /^evaluar$/i }).click();
  await expect(page.getByText(/todas las pruebas superadas/i)).toBeVisible({ timeout: 20_000 });
});

test('⭐ el error de Postgres se enseña tal cual', async ({ page }) => {
  await page.goto('/es/play/backend/sql-01-select');
  await waitForEditor(page);

  await writeQuery(page, 'SELECT nombre, precioo FROM productos;');
  await page.getByRole('button', { name: /ejecutar/i }).click();

  // El mensaje real de Postgres, con el nombre de la columna que no existe.
  // Se busca en el panel de resultados: el mismo texto aparece también en el
  // detalle de la comprobación fallida, y sin acotar hay dos coincidencias.
  await expect(page.locator('pre').filter({ hasText: 'does not exist' })).toBeVisible({
    timeout: BOOT,
  });
  await expect(page.locator('pre')).toContainText('column "precioo" does not exist');
});

test('⭐ cada ejecución parte del mismo estado (la transacción se deshace)', async ({ page }) => {
  await page.goto('/es/play/backend/sql-01-select');
  await waitForEditor(page);

  // Un INSERT seguido de un recuento: si el ROLLBACK no ocurriera, la segunda
  // ejecución contaría 9 y la lección dependería de cuántas veces has pulsado.
  const query =
    "INSERT INTO productos (nombre, categoria, precio, stock) VALUES ('Prueba', 'test', 1.00, 1);\nSELECT COUNT(*) AS total FROM productos;";
  await writeQuery(page, query);

  await page.getByRole('button', { name: /ejecutar/i }).click();
  await expect(page.locator('table')).toContainText('8', { timeout: BOOT });

  await page.getByRole('button', { name: /ejecutar/i }).click();
  await expect(page.locator('table')).toContainText('8');
  await expect(page.locator('table')).not.toContainText('9');
});

test('⭐ sql-03: el LEFT JOIN devuelve las categorías vacías', async ({ page }) => {
  await page.goto('/es/play/backend/sql-03-joins');
  await waitForEditor(page);

  // El punto de partida usa un JOIN normal: faltan dos categorías.
  await page.getByRole('button', { name: /ejecutar/i }).click();
  const grid = page.locator('table');
  await expect(grid).toContainText('audio', { timeout: BOOT });
  await expect(grid).not.toContainText('cables');

  await resolverPaso(page, 'sql-03-joins', 0);
  await writeQuery(
    page,
    'SELECT    c.nombre AS categoria, COUNT(p.id) AS productos\n' +
      'FROM      categorias c\n' +
      'LEFT JOIN productos p ON p.categoria_id = c.id AND p.descatalogado = FALSE\n' +
      'GROUP BY  c.nombre\n' +
      'ORDER BY  c.nombre;\n',
  );

  await page.getByRole('button', { name: /ejecutar/i }).click();
  await expect(grid).toContainText('cables', { timeout: BOOT });

  await page.getByRole('button', { name: /^evaluar$/i }).click();
  await expect(page.getByText(/todas las pruebas superadas/i)).toBeVisible({ timeout: 20_000 });
});

test('⭐ el track de Backend ya no está vacío', async ({ page }) => {
  await page.goto('/es/tracks/backend');
  await expect(page.getByText(/todavía no hay lecciones/i)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /SELECT/i }).first()).toBeVisible();
});
