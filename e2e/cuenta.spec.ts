import { expect, test, type Page } from '@playwright/test';

/**
 * Reclamar la cuenta anónima.
 *
 * El caso que importa no es «el formulario envía»: es que **el progreso
 * sobreviva** al borrado de la cookie y al salto a otro navegador. Por eso las
 * pruebas terminan el flujo entero contra el servidor de producción y luego
 * comprueban el XP en pantalla, que es lo que el usuario mira para saber si su
 * trabajo sigue ahí.
 */

const CLAVE = 'contrasena-larga-1';

/** Correo único por ejecución: el índice de correo es único y la base persiste. */
const correo = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@ejemplo.com`;

async function completarUnaLeccion(page: Page) {
  await page.goto('/es/play/frontend/css-01-selectors');
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });

  /*
   * Se marca el progreso por la misma API que usa la aplicación en vez de
   * jugar la lección entera. Lo que esta prueba tiene que demostrar es que el
   * progreso viaja con la cuenta; jugar de verdad ya se prueba en otros
   * archivos y aquí solo alargaría el tiempo de ejecución.
   */
  const respuesta = await page.request.post('/api/progress/complete', {
    data: {
      lessonId: 'css-01-selectors',
      seconds: 30,
      usedHints: false,
      hintPenalty: 0,
      flawless: true,
      comboMultiplier: 1,
    },
  });
  expect(respuesta.ok()).toBeTruthy();
}

async function xpEnPortada(page: Page): Promise<number> {
  await page.goto('/es');
  const texto = await page.locator('span', { hasText: /^\d+ XP$/ }).first().textContent();
  return Number((texto ?? '0').replace(/\D/g, ''));
}

test('⭐ reclamar la cuenta conserva el progreso y da un código de recuperación', async ({
  page,
}) => {
  await completarUnaLeccion(page);
  const antes = await xpEnPortada(page);
  expect(antes).toBeGreaterThan(0);

  await page.getByRole('button', { name: /guardar mi progreso/i }).click();
  await page.getByLabel(/^correo$/i).fill(correo());
  await page.getByLabel(/^contraseña$/i).fill(CLAVE);
  await page.getByRole('button', { name: /crear cuenta/i }).click();

  // El código se enseña una sola vez y hay que confirmarlo: solo se guarda su
  // hash, así que cerrarlo sin copiarlo es perderlo.
  const codigo = page.getByTestId('recovery-code');
  await expect(codigo).toBeVisible();
  await expect(codigo).toHaveText(/^[2-9A-HJ-NP-TV-Z]{4}(-[2-9A-HJ-NP-TV-Z]{4}){3}$/);

  await expect(page.getByRole('button', { name: /^continuar$/i })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /^continuar$/i }).click();

  // Reclamar conserva el id, así que el XP no se mueve.
  await expect(page.getByText(/sesión iniciada como/i)).toBeVisible();
  expect(await xpEnPortada(page)).toBe(antes);
});

test('⭐ el progreso sobrevive a perder la cookie: se entra y sigue ahí', async ({ page }) => {
  const email = correo();
  await completarUnaLeccion(page);
  const antes = await xpEnPortada(page);

  await page.getByRole('button', { name: /guardar mi progreso/i }).click();
  await page.getByLabel(/^correo$/i).fill(email);
  await page.getByLabel(/^contraseña$/i).fill(CLAVE);
  await page.getByRole('button', { name: /crear cuenta/i }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /^continuar$/i }).click();

  /*
   * Borrar las cookies es exactamente el escenario que hacía perder todo: sin
   * cuenta, aquí empezaba de cero y sin aviso.
   */
  await page.context().clearCookies();
  await page.goto('/es');
  await expect(page.getByText(/estás jugando sin cuenta/i)).toBeVisible();

  await page.getByRole('button', { name: /ya tengo cuenta/i }).click();
  await page.getByLabel(/^correo$/i).fill(email);
  await page.getByLabel(/^contraseña$/i).fill(CLAVE);
  await page.getByRole('button', { name: /^entrar$/i }).click();

  await expect(page.getByText(/sesión iniciada como/i)).toBeVisible();
  expect(await xpEnPortada(page)).toBe(antes);
});

test('⭐ lo jugado sin cuenta se suma al entrar, no se tira', async ({ page }) => {
  const email = correo();

  // Primera cuenta: se reclama vacía, sin nada jugado.
  await page.goto('/es');
  await page.getByRole('button', { name: /guardar mi progreso/i }).click();
  await page.getByLabel(/^correo$/i).fill(email);
  await page.getByLabel(/^contraseña$/i).fill(CLAVE);
  await page.getByRole('button', { name: /crear cuenta/i }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /^continuar$/i }).click();

  // Se cierra sesión y se juega como anónimo: es el caso del ordenador prestado.
  await page.getByRole('button', { name: /cerrar sesión/i }).click();
  await expect(page.getByText(/estás jugando sin cuenta/i)).toBeVisible();
  await completarUnaLeccion(page);
  const anonimo = await xpEnPortada(page);
  expect(anonimo).toBeGreaterThan(0);

  await page.getByRole('button', { name: /ya tengo cuenta/i }).click();
  await page.getByLabel(/^correo$/i).fill(email);
  await page.getByLabel(/^contraseña$/i).fill(CLAVE);
  await page.getByRole('button', { name: /^entrar$/i }).click();

  // Ese rato no desaparece al cambiar la cookie de dueño: viaja a la cuenta.
  await expect(page.getByText(/lecciones traídas de esta sesión/i)).toBeVisible();
  expect(await xpEnPortada(page)).toBe(anonimo);
});

test('⭐ una contraseña equivocada no dice si el correo existe', async ({ page }) => {
  const email = correo();
  await page.goto('/es');
  await page.getByRole('button', { name: /guardar mi progreso/i }).click();
  await page.getByLabel(/^correo$/i).fill(email);
  await page.getByLabel(/^contraseña$/i).fill(CLAVE);
  await page.getByRole('button', { name: /crear cuenta/i }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /^continuar$/i }).click();
  await page.getByRole('button', { name: /cerrar sesión/i }).click();

  const mensajes: string[] = [];
  for (const [correoProbado, clave] of [
    [email, 'clave-equivocada-1'],
    [`nadie-${Date.now()}@ejemplo.com`, CLAVE],
  ]) {
    await page.getByRole('button', { name: /ya tengo cuenta/i }).click();
    await page.getByLabel(/^correo$/i).fill(correoProbado);
    await page.getByLabel(/^contraseña$/i).fill(clave);
    await page.getByRole('button', { name: /^entrar$/i }).click();

    // `p[role=alert]` y no `getByRole('alert')`: Next mete su propio anunciador
    // de rutas con ese rol, y el selector genérico devuelve dos elementos.
    const aviso = page.locator('p[role="alert"]');
    await expect(aviso).toBeVisible();
    mensajes.push((await aviso.textContent()) ?? '');
    await page.reload();
  }

  // Si el mensaje cambiara, el formulario sería un buscador de qué correos
  // están registrados aquí.
  expect(mensajes[0]).toBe(mensajes[1]);
});

test('⭐ el código de recuperación es la única vía de reset, y funciona', async ({ page }) => {
  const email = correo();
  await page.goto('/es');
  await page.getByRole('button', { name: /guardar mi progreso/i }).click();
  await page.getByLabel(/^correo$/i).fill(email);
  await page.getByLabel(/^contraseña$/i).fill(CLAVE);
  await page.getByRole('button', { name: /crear cuenta/i }).click();

  const codigo = (await page.getByTestId('recovery-code').textContent()) ?? '';
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /^continuar$/i }).click();
  await page.getByRole('button', { name: /cerrar sesión/i }).click();

  await page.getByRole('button', { name: /ya tengo cuenta/i }).click();
  await page.getByRole('button', { name: /olvidado la contraseña/i }).click();

  await page.getByLabel(/^correo$/i).fill(email);
  await page.getByLabel(/^contraseña$/i).fill('clave-nueva-larga-2');
  await page.getByLabel(/código de recuperación/i).fill(codigo);
  await page.getByRole('button', { name: /cambiar contraseña/i }).click();

  // Cambiarla entra directamente, y entrega un código nuevo: el usado ya circuló.
  await expect(page.getByTestId('recovery-code')).toBeVisible();
  await expect(page.getByTestId('recovery-code')).not.toHaveText(codigo);
});
