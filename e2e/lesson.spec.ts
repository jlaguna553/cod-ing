import { expect, test, type Page } from '@playwright/test';

/**
 * E2E sobre el build de producción.
 *
 * Cubre lo que ningún test de Node puede: que Monaco monte de verdad, que el
 * iframe del runner ejecute código real, y —lo más importante— la invariante
 * del ADR-01 con navegación de cliente auténtica, que quedó pendiente desde
 * la Fase 1.
 */

const LESSON = '/es/play/frontend/js-03-array-map';

/** Espera a que Monaco esté montado y con algo dentro. */
async function waitForEditor(page: Page) {
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await expect(page.locator('.view-lines')).not.toBeEmpty({ timeout: 20_000 });
}

/** Espera además al contenido de partida de la lección (sin progreso previo). */
async function waitForPristineEditor(page: Page) {
  await waitForEditor(page);
  await expect(page.locator('.view-lines')).toContainText('prices', { timeout: 20_000 });
}

/** Escribe en Monaco sustituyendo todo el contenido. */
async function typeInEditor(page: Page, text: string) {
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(text, { delay: 8 });
}

/**
 * Sustituye el contenido insertando el texto de golpe.
 *
 * Necesario para CSS y HTML: al teclear carácter a carácter, Monaco cierra
 * solo las llaves y las etiquetas, y el `}` o el `</html>` que escribe el test
 * acaba duplicado. `insertText` no dispara el autocierre, que solo actúa sobre
 * pulsaciones sueltas.
 */
async function insertInEditor(page: Page, text: string) {
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}

/**
 * Deja la consola a la vista.
 *
 * En una lección que solo imprime —`js-01`— la consola ES el panel y no hay
 * pestañas que pulsar; en una visual sí las hay. El test no debería saber
 * cuál es cuál: pulsa la pestaña si existe.
 */
async function openConsole(page: Page) {
  const tab = page.getByRole('button', { name: /consola/i });
  if ((await tab.count()) > 0) await tab.click();
}

test('la lección carga con el editor y el enunciado del paso', async ({ page }) => {
  await page.goto(LESSON);
  await waitForPristineEditor(page);

  await expect(page.getByText('Un array nuevo, no el mismo')).toBeVisible();
  await expect(page.getByRole('button', { name: /ejecutar/i })).toBeVisible();
});

test('⭐ cambiar de idioma conserva el código escrito (ADR-01)', async ({ page }) => {
  await page.goto(LESSON);
  await waitForPristineEditor(page);

  const code = 'const withTax = prices.map((p) => p * 1.21);';
  await typeInEditor(page, code);
  await expect(page.locator('.view-lines')).toContainText('withTax');

  // Cambio de idioma con navegación de cliente real, no recarga.
  await page.getByRole('radio', { name: /english|inglés/i }).click();
  await expect(page).toHaveURL(/\/en\/play\/frontend\/js-03-array-map/);

  // El texto SÍ cambia...
  await expect(page.getByText('A new array, not the same one')).toBeVisible({ timeout: 15_000 });

  // ...y el código escrito NO se pierde.
  await waitForEditor(page);
  await expect(page.locator('.view-lines')).toContainText('withTax');
  await expect(page.locator('.view-lines')).toContainText('1.21');
});

test('el runner de DOM ejecuta el código y evalúa las reglas', async ({ page }) => {
  await page.goto(LESSON);
  await waitForPristineEditor(page);

  await typeInEditor(page, 'const prices = [10, 25, 40, 5];\nconst withTax = prices.map((p) => p * 1.21);\nconsole.log(withTax);');

  await page.getByRole('button', { name: /validar paso/i }).click();

  // `uses-map` es una regla AST: debe pasar a verde con el código correcto.
  await expect(page.getByText('.map() devuelve un array nuevo')).toBeVisible({ timeout: 15_000 });
});

test('el panel de pruebas distingue pendiente de fallido', async ({ page }) => {
  await page.goto(LESSON);
  await waitForEditor(page);

  // Sin haber tocado nada ni ejecutado: nada debe estar en rojo todavía.
  const failed = page.locator('svg.lucide-x');
  await expect(failed).toHaveCount(0);
});

test('las partículas del Power Mode se apagan en modo rendimiento', async ({ page }) => {
  await page.goto(LESSON);
  await waitForEditor(page);

  await page.getByLabel(/modo rendimiento/i).check();
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-performance-mode', 'true');
});

test('el contador de pulsaciones sobrevive al cambio de idioma', async ({ page }) => {
  await page.goto(LESSON);
  await waitForEditor(page);

  await typeInEditor(page, 'const a = 1;');
  const before = await page.locator('p.font-mono.tabular-nums').first().textContent();
  expect(Number(before?.replace(/\D/g, ''))).toBeGreaterThan(0);

  await page.getByRole('radio', { name: /english|inglés/i }).click();
  await expect(page).toHaveURL(/\/en\//);

  const after = await page.locator('p.font-mono.tabular-nums').first().textContent();
  expect(Number(after?.replace(/\D/g, ''))).toBeGreaterThan(0);
});

test('⭐ mantiene el ritmo de fotogramas tecleando con los efectos activos', async ({ page }) => {
  await page.goto(LESSON);
  await waitForEditor(page);

  await page.locator('.monaco-editor .view-lines').click();

  // Contador de fotogramas montado ANTES de teclear.
  await page.evaluate(() => {
    (window as unknown as { __frames: number }).__frames = 0;
    const count = () => {
      (window as unknown as { __frames: number }).__frames++;
      requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
  });

  // ~2 s de tecleo sostenido a ~50 pulsaciones/segundo: por encima de lo que
  // teclea una persona rápida, para que el margen sea real.
  const started = Date.now();
  await page.keyboard.type('const withTax = prices.map((price) => price * 1.21);', { delay: 20 });
  await page.keyboard.type('const doubled = prices.map((price) => price * 2);', { delay: 20 });
  const elapsed = Date.now() - started;

  const frames = await page.evaluate(
    () => (window as unknown as { __frames: number }).__frames,
  );
  const fps = frames / (elapsed / 1000);

  console.log(`fps medidos: ${fps.toFixed(1)} (${frames} fotogramas en ${elapsed} ms)`);
  // Umbral conservador: headless en CI no siempre llega a 60 reales.
  expect(fps).toBeGreaterThan(30);
});

test('⭐ el combo sube al teclear y aparece el contador', async ({ page }) => {
  await page.goto(LESSON);
  await waitForEditor(page);
  await page.locator('.monaco-editor .view-lines').click();

  // El contador solo aparece a partir de 10 pulsaciones: por debajo sería ruido.
  await page.keyboard.type('const abcdefghijklmnop = 1;', { delay: 15 });

  await expect(page.getByText(/×$/)).toBeVisible({ timeout: 5000 });
  const combo = await page.evaluate(
    () => JSON.parse(localStorage.getItem('codequest.game') ?? '{}'),
  );
  expect(combo?.state?.stats?.bestCombo ?? 0).toBeGreaterThanOrEqual(10);
});

test('⭐ pegar un bloque grande rompe el combo (anti-cheat)', async ({ page }) => {
  await page.goto(LESSON);
  await waitForEditor(page);
  await page.locator('.monaco-editor .view-lines').click();

  await page.keyboard.type('const abcdefghijklmnopqrs = 1;', { delay: 15 });
  await expect(page.getByText(/×$/)).toBeVisible({ timeout: 5000 });

  // Pegado por encima del umbral: el contador debe desaparecer.
  await page.evaluate(async () => {
    await navigator.clipboard.writeText(
      'const withTax = prices.map((price) => price * 1.21); // mucho más de 40 caracteres',
    );
  });
  await page.keyboard.press('ControlOrMeta+v');

  await expect(page.getByText(/×$/)).toBeHidden({ timeout: 5000 });
});

test('el selector de packs de sonido ofrece las seis opciones', async ({ page }) => {
  await page.goto(LESSON);
  await waitForEditor(page);

  const select = page.getByLabel(/sonido de tecleo/i);
  await expect(select).toBeVisible();
  await expect(select.locator('option')).toHaveCount(6);
  // Silencio por defecto: sonido inesperado en unos auriculares es hostil.
  await expect(select).toHaveValue('silent');
});

test('⭐ el progreso persiste: el código escrito vuelve tras recargar', async ({ page }) => {
  await page.goto(LESSON);
  await waitForEditor(page);

  const marker = `const persistido = ${Date.now()};`;
  await typeInEditor(page, marker);

  // El autosave tiene 2,5 s de debounce; se espera a que llegue al servidor.
  await page.waitForResponse(
    (response) => response.url().includes('/api/progress') && response.request().method() === 'POST',
    { timeout: 20_000 },
  );

  await page.reload();
  await waitForEditor(page);

  await expect(page.locator('.view-lines')).toContainText('persistido', { timeout: 20_000 });
});

test('⭐ el servidor calcula el XP: no acepta la cifra del cliente', async ({ request }) => {
  // Un cliente malicioso pediría 999999. La respuesta debe ser el XP real de
  // la lección, no lo que se envíe.
  const response = await request.post('/api/progress/complete', {
    data: {
      lessonId: 'js-01-variables',
      seconds: 60,
      usedHints: false,
      hintPenalty: 0,
      flawless: true,
      comboMultiplier: 1,
      xpAwarded: 999999,
      totalXp: 999999,
    },
  });

  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  // js-01-variables reparte 90 base + 35 flawless + 20 sin pistas = 145.
  expect(body.xpAwarded).toBe(145);
});

test('⭐ completar dos veces no paga dos veces', async ({ request }) => {
  const payload = {
    lessonId: 'js-02-functions',
    seconds: 90,
    usedHints: true,
    hintPenalty: 0,
    flawless: false,
    comboMultiplier: 1,
  };

  const first = await (await request.post('/api/progress/complete', { data: payload })).json();
  const second = await (await request.post('/api/progress/complete', { data: payload })).json();

  expect(first.xpAwarded).toBeGreaterThan(0);
  expect(second.xpAwarded).toBe(0);
  expect(second.alreadyCompleted).toBe(true);
});

test('la API rechaza lecciones inexistentes y cuerpos inválidos', async ({ request }) => {
  const unknown = await request.post('/api/progress/complete', {
    data: { lessonId: 'no-existe', seconds: 1, usedHints: false, hintPenalty: 0, flawless: false, comboMultiplier: 1 },
  });
  expect(unknown.status()).toBe(404);

  const malformed = await request.post('/api/progress', { data: { lessonId: 'js-01-variables' } });
  expect(malformed.status()).toBe(400);
});

/**
 * El selector de idioma en TODAS las pantallas y en AMBAS direcciones.
 *
 * La suite solo probaba ES→EN dentro de una lección, y así se coló que la
 * página de track no tenía selector: quedarse sin él a mitad de navegación
 * obliga a editar la URL a mano para volver al idioma anterior.
 */
for (const screen of [
  { name: 'home', path: '/en', marker: 'Elige tu ruta' },
  { name: 'track', path: '/en/tracks/frontend', marker: 'Frontend' },
  { name: 'lección', path: '/en/play/frontend/js-01-variables', marker: 'Nivel 1' },
]) {
  test(`⭐ el idioma se puede cambiar desde ${screen.name} (EN → ES)`, async ({ page }) => {
    await page.goto(screen.path);

    const switcher = page.getByRole('radio', { name: /spanish|español|^es$/i }).first();
    await expect(switcher, `${screen.name} debe ofrecer el selector de idioma`).toBeVisible({
      timeout: 20_000,
    });

    await switcher.click();
    await expect(page).toHaveURL(new RegExp(`/es${screen.path === '/en' ? '$' : ''}`));
    await expect(page.getByText(screen.marker).first()).toBeVisible({ timeout: 20_000 });
  });
}

/**
 * Navegación real: home → track → clic en lección.
 *
 * Toda la suite entraba con `page.goto()` directo a la URL. Este es el camino
 * que recorre una persona, con navegación de cliente, y no estaba cubierto.
 */
test('⭐ se puede llegar a una lección navegando, no solo por URL', async ({ page }) => {
  await page.goto('/es');

  await page.getByRole('link', { name: /Frontend/i }).first().click();
  await expect(page).toHaveURL(/\/es\/tracks\/frontend/);

  await page
    .getByRole('link')
    .filter({ hasText: /Guardar datos|const/i })
    .first()
    .click();

  await expect(page).toHaveURL(/\/es\/play\/frontend\//);
  await expect(page.getByText('Ninguna lección cargada')).toHaveCount(0);
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
});

/** Ninguna lección puede quedarse sin editor ni con el panel vacío. */
for (const [track, id] of [
  ['frontend', 'vue-03-reactivity'],
  ['frontend', 'react-10-render-performance'],
  ['devops', 'docker-07-layer-cache'],
  ['devops', 'docker-03-dockerfile-basics'],
  ['devops', 'docker-05-images-layers'],
] as const) {
  test(`la lección ${id} monta su editor y su contenido`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(`/es/play/${track}/${id}`);
    await page.waitForSelector('.monaco-editor', { timeout: 30_000 });

    await expect(page.getByText('Ninguna lección cargada')).toHaveCount(0);
    expect(errors, `errores de cliente en ${id}`).toEqual([]);
  });
}

test('⭐ el reto tiene su propia sección, después de la explicación', async ({ page }) => {
  await page.goto(LESSON);
  await waitForPristineEditor(page);

  const task = page.locator('section[aria-labelledby="task-heading"]');
  await expect(task).toBeVisible();
  await expect(task).toContainText('.map()');

  // El reto va DESPUÉS de la explicación: primero se entiende, luego se aplica.
  // Que ahora esté fijado no cambia ese orden — solo que ya no se pierde al
  // desplazarse por la guía.
  const taskBox = await task.boundingBox();
  const guideBox = await page.getByText('Un array nuevo, no el mismo').boundingBox();
  expect(taskBox!.y).toBeGreaterThan(guideBox!.y);
});

test('⭐ una comprobación superada no muestra el mensaje de fallo en verde', async ({ page }) => {
  await page.goto('/es/play/frontend/js-01-variables');
  await waitForEditor(page);

  await typeInEditor(
    page,
    "const playerName = 'Ada';\nlet score = 0;\nscore = score + 10;\nconst team = 'cyan';\nconsole.log(playerName, score, team);",
  );
  await page.getByRole('button', { name: /validar paso/i }).click();
  await page.waitForTimeout(1500);

  // La regla `no-var` pasa; su mensaje ("¡Daño! `var` es la forma antigua…")
  // está redactado para el fallo y no puede encabezar una fila en verde.
  const damageText = page.getByText('¡Daño!', { exact: false }).first();
  if (await damageText.count()) {
    const row = damageText.locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]');
    await expect(row.getByText('Superada')).toBeVisible();
  }
});

test('⭐ validar sin ejecutar deja las pruebas de salida pendientes, no en rojo', async ({ page }) => {
  await page.goto('/es/play/frontend/js-01-variables');
  await waitForEditor(page);

  // Se valida SIN pulsar Ejecutar: la comprobación de stdout no puede
  // marcarse en rojo por una salida que nadie ha producido todavía.
  await page.getByRole('button', { name: /validar paso/i }).click();
  await page.waitForTimeout(1500);

  const outputCheck = page.getByText('La salida esperada es', { exact: false }).first();
  await expect(outputCheck).toBeVisible();

  const row = outputCheck.locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]');
  await expect(row.locator('svg.lucide-x')).toHaveCount(0);
});

test('⭐ un error de sintaxis se explica en vez de dejar todo en gris', async ({ page }) => {
  await page.goto('/es/play/frontend/js-01-variables');
  await waitForEditor(page);

  // El error exacto que produce cambiar `var` por `let` en una reasignación.
  await typeInEditor(page, "const playerName = 'Ada';\nlet score = 0;\nlet = score + 10;");
  await page.getByRole('button', { name: /validar paso/i }).click();

  await expect(page.getByText(/no compila/i)).toBeVisible({ timeout: 10_000 });
});

test('⭐ la salida de console.log se puede ver en la consola', async ({ page }) => {
  await page.goto('/es/play/frontend/js-01-variables');
  await waitForEditor(page);

  await typeInEditor(
    page,
    "const playerName = 'Ada';\nlet score = 0;\nscore = score + 10;\nconst team = 'cyan';\nconsole.log(playerName, score, team);",
  );
  await page.getByRole('button', { name: /ejecutar/i }).click();

  // Sin esta pestaña, una lección que imprime con console.log no tiene dónde
  // mostrar su resultado: la vista previa solo enseña el DOM.
  await openConsole(page);
  await expect(page.getByRole('log', { name: /consola/i })).toContainText('Ada 10 cyan', { timeout: 15_000 });
});

test('⭐ el flujo completo de js-01 termina con las comprobaciones en verde', async ({ page }) => {
  await page.goto('/es/play/frontend/js-01-variables');
  await waitForEditor(page);

  await typeInEditor(
    page,
    "const playerName = 'Ada';\nlet score = 0;\nscore = score + 10;\nconst team = 'cyan';\nconsole.log(playerName, score, team);",
  );

  // Se espera a que la ejecución produzca salida antes de validar, en vez de
  // dormir un tiempo fijo: el arranque del iframe varía con la carga.
  await page.getByRole('button', { name: /ejecutar/i }).click();
  await openConsole(page);
  // Se busca DENTRO de la consola: «Ada 10 cyan» también aparece en el texto
  // de la regla, y buscarlo en toda la página daba un positivo inmediato que
  // hacía validar antes de que el código hubiera llegado a ejecutarse.
  await expect(page.getByRole('log', { name: /consola/i })).toContainText('Ada 10 cyan', { timeout: 20_000 });

  await page.getByRole('button', { name: /validar paso/i }).click();
  await expect(page.getByText(/todas las pruebas superadas/i)).toBeVisible({ timeout: 20_000 });
});

test('⭐ la salida evaluada solo contiene la ejecución actual', async ({ page }) => {
  await page.goto('/es/play/frontend/js-02-functions');
  await waitForEditor(page);

  await typeInEditor(
    page,
    "const greet = (name) => 'Hola, ${name}';\n\nconsole.log(greet('Ada'));",
  );
  await page.getByRole('button', { name: /ejecutar/i }).click();
  await openConsole(page);
  await expect(page.getByRole('log', { name: /consola/i })).toContainText('Hola, ${name}', {
    timeout: 15_000,
  });

  await typeInEditor(
    page,
    "const greet = (name) => `Hola, ${name}`;\n\nconsole.log(greet('Ada'));",
  );
  await page.getByRole('button', { name: /ejecutar/i }).click();
  await page.getByRole('button', { name: /ejecutar/i }).click();
  await page.getByRole('button', { name: /ejecutar/i }).click();

  await page.getByRole('button', { name: /validar paso/i }).click();
  const outputCheck = page.getByText('La salida esperada es exactamente', { exact: false });
  const row = outputCheck.locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]');
  await expect(row.locator('svg.lucide-x')).toHaveCount(0, { timeout: 15_000 });
  await expect(row).not.toContainText('${name}');
  await expect(row).not.toContainText('Hola, Ada Hola, Ada');
});

test('⭐ al terminar la lección hay salida: XP y enlace a la siguiente', async ({ page }) => {
  await page.goto('/es/play/frontend/js-01-variables');
  await waitForEditor(page);

  await typeInEditor(
    page,
    "const playerName = 'Ada';\nlet score = 0;\nscore = score + 10;\nconst team = 'cyan';\nconsole.log(playerName, score, team);",
  );
  await page.getByRole('button', { name: /ejecutar/i }).click();
  await openConsole(page);
  await expect(page.getByRole('log', { name: /consola/i })).toContainText('Ada 10 cyan', {
    timeout: 20_000,
  });

  await page.getByRole('button', { name: /validar paso/i }).click();
  await expect(page.getByText(/todas las pruebas superadas/i)).toBeVisible({ timeout: 20_000 });

  // Segundo paso: no tiene comprobaciones, así que se da por superado y el
  // botón pasa a ser «Terminar lección».
  await page.getByRole('button', { name: /siguiente/i }).click();
  const finish = page.getByRole('button', { name: /terminar lección/i });
  await expect(finish).toBeVisible({ timeout: 10_000 });
  await finish.click();

  // La salida que faltaba: saber que acabaste y por dónde seguir.
  await expect(page.getByText(/lección completada/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: /siguiente lección/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /volver al mapa/i })).toBeVisible();
});

test('⭐ un paso sin comprobaciones no se queda bloqueado', async ({ page }) => {
  await page.goto('/es/play/frontend/js-01-variables');
  await waitForEditor(page);

  await page.getByRole('button', { name: /siguiente/i }).click();
  await page.getByRole('button', { name: /validar paso/i }).click();

  // El paso 2 de js-01 es de solo lectura: debe darse por superado igualmente.
  await expect(page.getByText(/paso superado/i)).toBeVisible({ timeout: 10_000 });
});

test('⭐ css-03: el reset de border-box cambia lo que el navegador dibuja', async ({ page }) => {
  await page.goto('/es/play/frontend/css-03-box-model');
  await waitForEditor(page);

  // Paso 1: la página se mide a sí misma y delata el modelo por defecto.
  await page.getByRole('button', { name: /ejecutar/i }).click();
  await openConsole(page);
  const console_ = page.getByRole('log', { name: /consola/i });
  await expect(console_).toContainText('ocupa 356px', { timeout: 20_000 });

  await page.getByRole('button', { name: /siguiente/i }).click();

  // Paso 2: el reset universal, sin tocar una sola anchura ni el padding.
  await insertInEditor(
    page,
    '*,\n*::before,\n*::after {\n  box-sizing: border-box;\n}\n\n' +
      'body {\n  margin: 0;\n}\n\n' +
      '.card {\n  width: 300px;\n  padding: 24px;\n  border: 4px solid #7c3aed;\n}\n\n' +
      '.badge {\n  display: inline-block;\n  width: 120px;\n  padding: 6px 10px;\n  border: 2px solid #22d3ee;\n}\n',
  );

  await page.getByRole('button', { name: /ejecutar/i }).click();
  // Se espera la ÚLTIMA línea de la ejecución, no la primera: los dos
  // `console.log` llegan en mensajes distintos y validar entre uno y otro
  // deja la comprobación de la insignia sin salida que leer.
  await expect(console_).toContainText('ocupa 120px', { timeout: 20_000 });

  await page.getByRole('button', { name: /validar paso/i }).click();
  await expect(page.getByText(/todas las pruebas superadas/i)).toBeVisible({ timeout: 20_000 });
});

test('⭐ html-01: el esqueleto completo se valida sin cambiar lo que se ve', async ({ page }) => {
  await page.goto('/es/play/frontend/html-01-first-page');
  await waitForEditor(page);

  await page.getByRole('button', { name: /siguiente/i }).click();
  await insertInEditor(
    page,
    '<!doctype html>\n<html lang="es">\n<head>\n' +
      '<meta charset="utf-8" />\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
      '<title>Mi primera página</title>\n' +
      '</head>\n<body>\n<h1>Mi primera página</h1>\n</body>\n</html>\n',
  );

  await page.getByRole('button', { name: /ejecutar/i }).click();
  // La lección no imprime nada —ese es justo su tema—, así que la señal de que
  // el documento nuevo ya está montado es el `<title>` que antes no existía.
  await expect(page.locator('iframe[title="preview"]')).toHaveAttribute('srcdoc', /<title>/, {
    timeout: 20_000,
  });

  await page.getByRole('button', { name: /validar paso/i }).click();
  await expect(page.getByText(/todas las pruebas superadas/i)).toBeVisible({ timeout: 20_000 });
});

test('⭐ docker-03: la terminal construye la imagen y la lección lo registra', async ({ page }) => {
  await page.goto('/es/play/devops/docker-03-dockerfile-basics');
  await waitForEditor(page);

  // `cli-sim` no tiene vista previa: la terminal ocupa el panel entero.
  const rows = page.locator('.xterm-rows');
  await expect(rows).toBeVisible({ timeout: 20_000 });

  await page.locator('.xterm').click();
  await page.keyboard.type('docker build -t api .');
  await page.keyboard.press('Enter');
  await expect(rows).toContainText('Successfully built', { timeout: 20_000 });

  // La regla del paso 1 es una transcripción: exige haber ejecutado el
  // comando de verdad, no escribir el Dockerfile correcto de memoria.
  await page.getByRole('button', { name: /validar paso/i }).click();
  await expect(page.getByText(/todas las pruebas superadas/i)).toBeVisible({ timeout: 20_000 });
});

test('⭐ ejecutar varias veces no acumula la salida en la evaluación', async ({ page }) => {
  await page.goto('/es/play/frontend/js-02-functions');
  await waitForEditor(page);

  // Primer intento MAL: comillas simples, así que imprime `Hola, ${name}`.
  await typeInEditor(page, "const greet = (name) => 'Hola, ${name}';\nconsole.log(greet('Ada'));");
  await page.getByRole('button', { name: /ejecutar/i }).click();
  await page.waitForTimeout(2500);

  // Ahora BIEN, con plantilla.
  await typeInEditor(page, 'const greet = (name) => `Hola, ${name}`;\nconsole.log(greet("Ada"));');
  await page.getByRole('button', { name: /ejecutar/i }).click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /validar paso/i }).click();

  // Sin acotar la salida a la última ejecución, el stdout traía las dos
  // pegadas y la comprobación fallaba con la solución correcta delante.
  await expect(page.getByText(/todas las pruebas superadas/i)).toBeVisible({ timeout: 20_000 });
});
