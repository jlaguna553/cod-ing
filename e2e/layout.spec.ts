import { expect, test, type Page } from '@playwright/test';

/**
 * Invariantes del layout de la pantalla de juego.
 *
 * Lo que se comprueba aquí no es estética: es que las dos piezas que se
 * consultan *mientras* se escribe código —el reto y las pruebas— sigan en
 * pantalla después de desplazarse por una guía larga, y que una lección no
 * ofrezca herramientas que no usa.
 */

async function waitForEditor(page: Page) {
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await expect(page.locator('.view-lines')).not.toBeEmpty({ timeout: 20_000 });
}

/** La región que scrollea: la guía. */
function guide(page: Page) {
  return page.getByRole('heading', { name: /^guía$/i }).locator('xpath=ancestor::section[1]');
}

test('⭐ el reto y las pruebas sobreviven al scroll de la guía', async ({ page }) => {
  // docker-05 tiene los pasos más largos del temario: si algo se va, se va aquí.
  await page.goto('/es/play/devops/docker-05-images-layers');
  await waitForEditor(page);

  const task = page.getByRole('region', { name: /tu turno/i });
  const tests = page.getByRole('heading', { name: /^pruebas$/i });

  await expect(task).toBeInViewport();
  await expect(tests).toBeInViewport();

  const before = await task.boundingBox();

  // Se desplaza el contenido didáctico hasta el fondo.
  const scroller = guide(page).locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
  await scroller.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect
    .poll(async () => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(100);

  // El reto no se ha movido ni un píxel, y las pruebas siguen a la vista.
  await expect(task).toBeInViewport();
  await expect(tests).toBeInViewport();
  expect(await task.boundingBox()).toEqual(before);
});

test('⭐ la página no scrollea: el scroll vive dentro de la guía', async ({ page }) => {
  await page.goto('/es/play/devops/docker-05-images-layers');
  await waitForEditor(page);

  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollHeight,
    client: document.documentElement.clientHeight,
  }));
  // Un par de píxeles de holgura por redondeo de subpíxel.
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 2);
});

test('⭐ una lección de consola no ofrece una vista previa vacía', async ({ page }) => {
  await page.goto('/es/play/frontend/js-01-variables');
  await waitForEditor(page);

  // Sin pestañas: la única salida es la consola, y el panel lo dice.
  await expect(page.getByRole('button', { name: /vista previa/i })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /consola/i })).toBeVisible();

  await page.getByRole('button', { name: /ejecutar/i }).click();
  await expect(page.getByRole('log', { name: /consola/i })).toContainText('Ada', { timeout: 20_000 });
});

test('⭐ una lección visual sigue abriendo en la vista previa', async ({ page }) => {
  await page.goto('/es/play/frontend/css-03-box-model');
  await waitForEditor(page);

  await expect(page.getByRole('button', { name: /vista previa/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /consola/i })).toBeVisible();
});

test('⭐ el árbol se pliega cuando la lección tiene un solo archivo', async ({ page }) => {
  await page.goto('/es/play/frontend/js-01-variables');
  await waitForEditor(page);

  const toggle = page.getByRole('button', { expanded: false }).filter({ hasText: /archivo/i });
  await expect(toggle).toBeVisible();

  // Plegado no es inaccesible: sigue abriéndose.
  await toggle.click();
  await expect(page.getByRole('button', { name: /index\.js/ })).toBeVisible();
});

test('⭐ el árbol se muestra desplegado cuando hay varios archivos', async ({ page }) => {
  await page.goto('/es/play/frontend/css-03-box-model');
  await waitForEditor(page);

  await expect(page.getByRole('button', { name: /styles\.css/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /index\.html/ })).toBeVisible();
});

test('⭐ una lección con prerequisitos pendientes se puede abrir igualmente', async ({ page }) => {
  await page.goto('/es/tracks/frontend');

  // `react-10` cuelga de media cadena de React y de JavaScript. Sin progreso,
  // antes salía con candado y sin enlace; ahora avisa y deja pasar.
  const row = page.getByRole('link', { name: /igualdad referencial|render/i }).first();
  await expect(row).toBeVisible();
  await expect(page.getByText(/recomendado antes/i).first()).toBeVisible();

  await row.click();
  await expect(page).toHaveURL(/\/play\/frontend\//);
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
});

test('⭐ el aviso nombra las lecciones, no un número', async ({ page }) => {
  await page.goto('/es/tracks/backend');

  /*
   * Se comprueba la FORMA del aviso, no qué lección lo lleva.
   *
   * Antes se afirmaba que el primero era de SQL, y al añadir el módulo de C#
   * el primero pasó a ser otro y el test se puso rojo sin que nada estuviera
   * mal. Lo que esta prueba defiende es que el aviso nombre lecciones —
   * «requiere 2 lecciones previas» no dice cuáles y con eso no se decide nada—,
   * y eso no depende de en qué orden estén los módulos.
   */
  const notices = page.getByText(/recomendado antes/i);
  await expect(notices.first()).toBeVisible();

  for (const text of await notices.allInnerTexts()) {
    const nombradas = text.replace(/^.*?recomendado antes:\s*/i, '').trim();
    expect(nombradas.length, `el aviso no nombra nada: "${text}"`).toBeGreaterThan(10);
    expect(nombradas, `el aviso cuenta en vez de nombrar: "${text}"`).not.toMatch(
      /^\d+\s+lecc/i,
    );
  }
});

test('⭐ los paneles de la guía no se solapan entre sí', async ({ page }) => {
  // Con `scroll={false}` nada recorta el contenido del panel, así que si el
  // contenedor flex lo comprime el texto se sale y se dibuja encima del
  // siguiente. Pasó de verdad: la guía se derramaba sobre las pistas.
  await page.goto('/es/play/frontend/vue-01-template-syntax');
  await waitForEditor(page);

  const cajas = await page.evaluate(() => {
    const paneles = Array.from(document.querySelectorAll('aside section')).filter((seccion) =>
      /guía|pistas|briefing/i.test(seccion.querySelector('h2')?.textContent ?? ''),
    );
    return paneles.map((panel) => {
      const rect = panel.getBoundingClientRect();
      return {
        titulo: panel.querySelector('h2')?.textContent?.trim() ?? '',
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        // Lo que el panel ocupa de verdad frente a lo que dice medir.
        overflow: Math.round(panel.scrollHeight - panel.clientHeight),
      };
    });
  });

  expect(cajas.length, 'no se encontró la guía').toBeGreaterThan(0);

  for (const caja of cajas) {
    expect(caja.overflow, `«${caja.titulo}» desborda su propia caja`).toBeLessThanOrEqual(1);
  }

  // Y ninguno invade al siguiente.
  const ordenados = [...cajas].sort((a, b) => a.top - b.top);
  for (let i = 1; i < ordenados.length; i += 1) {
    expect(
      ordenados[i].top,
      `«${ordenados[i - 1].titulo}» se solapa con «${ordenados[i].titulo}»`,
    ).toBeGreaterThanOrEqual(ordenados[i - 1].bottom - 1);
  }
});
