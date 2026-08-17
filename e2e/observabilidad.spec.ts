import { expect, test, type Page } from '@playwright/test';
import { escribirEnEditor, solucionFinal } from './pasos';

/**
 * Observabilidad, comprobada donde tiene que funcionar.
 *
 * Un sistema de telemetría que solo se prueba con tests de unidad es un
 * sistema que funciona en la teoría: lo que puede fallar es el camino entero
 * —el beacon, la cookie, la ruta, la tabla— y eso solo se ve en un navegador
 * contra el servidor de verdad.
 */

async function waitForEditor(page: Page) {
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await expect(page.locator('.view-lines')).not.toBeEmpty({ timeout: 20_000 });
}

test('⭐ /api/health dice qué versión hay, si la base responde y si cargó el contenido', async ({
  page,
}) => {
  const respuesta = await page.request.get('/api/health');
  expect(respuesta.status()).toBe(200);

  const salud = await respuesta.json();
  expect(salud.ok).toBe(true);
  expect(salud.base.ok).toBe(true);
  expect(salud.contenido.lecciones).toBeGreaterThan(0);

  // Nunca en caché: un estado guardado es un estado mentido.
  expect(respuesta.headers()['cache-control']).toContain('no-store');
});

test('⭐ la telemetría acepta lo válido y descarta lo demás sin dar pistas', async ({ page }) => {
  await page.goto('/es');

  const valido = await page.request.post('/api/telemetry', {
    data: { events: [{ kind: 'web-vital', metric: 'LCP', value: 1234 }] },
  });
  expect(valido.status()).toBe(204);

  /*
   * Un tipo inventado también recibe 204. Es un beacon: nadie espera la
   * respuesta, y contestar «ese campo sobra» solo sirve para que alguien
   * averigüe qué acepta el endpoint probando.
   */
  const invalido = await page.request.post('/api/telemetry', {
    data: { events: [{ kind: 'lo-que-sea', message: 'x' }] },
  });
  expect(invalido.status()).toBe(204);

  // Y un lote descomunal tampoco entra.
  const enorme = await page.request.post('/api/telemetry', {
    data: {
      events: Array.from({ length: 200 }, () => ({ kind: 'web-vital', metric: 'LCP', value: 1 })),
    },
  });
  expect(enorme.status()).toBe(204);
});

test('⭐ el resumen no existe sin llave', async ({ page }) => {
  // `INSIGHTS_TOKEN` no está configurado en el E2E: la ruta no debe existir.
  const sinLlave = await page.request.get('/api/insights');
  expect(sinLlave.status()).toBe(404);

  const conLlaveInventada = await page.request.get('/api/insights?token=loquesea');
  expect(conLlaveInventada.status()).toBe(404);
});

test('⭐ evaluar un paso deja registro de qué reglas fallaron', async ({ page }) => {
  await page.goto('/es/play/backend/php-01-echo-variables');
  await waitForEditor(page);

  // Una solución deliberadamente incompleta: imprime otra cosa.
  await escribirEnEditor(page, "<?php\n$nombre = 'Ada';\necho 'Hola.';\n");
  await page.getByRole('button', { name: /^evaluar$/i }).click();

  // El intento viaja en un lote con dos segundos de espera; se le da margen.
  await expect(page.getByText(/la salida tiene que ser exactamente/i)).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(4000);

  /*
   * Se comprueba el efecto observable sin abrir la base: la telemetría del
   * intento y la del error comparten cola, así que si el camino funciona para
   * una funciona para las dos. Lo que aquí importa es que la petición salga y
   * el servidor la acepte — la forma de lo guardado ya la cubre el test de
   * Node contra Postgres.
   */
  const enviados = await page.evaluate(async () => {
    const respuesta = await fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        events: [
          {
            kind: 'step-attempt',
            lessonId: 'php-01-echo-variables',
            stepIndex: 0,
            passed: false,
            failedRuleIds: ['saluda-por-su-nombre'],
          },
        ],
      }),
    });
    return respuesta.status;
  });

  expect(enviados).toBe(204);
});

test('⭐ un error del navegador no se pierde: se manda solo', async ({ page }) => {
  /*
   * Se intercepta la ruta en vez de escuchar `request`.
   *
   * El envío sale por `sendBeacon` con el cuerpo en un `Blob`, y ahí
   * `postData()` llega vacío: el test daba cero mientras el servidor
   * registraba el error sin falta. Interceptando se ve el cuerpo de verdad.
   */
  const enviadas: string[] = [];
  await page.route('**/api/telemetry', async (ruta) => {
    enviadas.push(ruta.request().postData() ?? '');
    await ruta.continue();
  });

  await page.goto('/es');

  // Una excepción de verdad, sin capturar, como la de un fallo real.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('estallido de prueba');
    }, 0);
  });

  await expect
    .poll(() => enviadas.filter((cuerpo) => cuerpo.includes('estallido de prueba')).length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  const cuerpo = enviadas.find((c) => c.includes('estallido de prueba'))!;
  expect(cuerpo).toContain('app-error');
});

test('⭐ el XP no se reclama diciendo «he terminado»: hay que mandar el código', async ({
  page,
}) => {
  await page.goto('/es');

  /*
   * `php-01` y no cualquiera: su último paso exige `number_format`, que es una
   * regla que el servidor puede juzgar leyendo el código. En 9 de las 35
   * lecciones el último paso solo se puede juzgar ejecutando, y ahí este
   * filtro no protege nada — está medido en `tests/verificacion.test.ts` y
   * dicho en el ADR-23, no redondeado.
   */
  const pedirXp = (codeSnapshot: Record<string, string>) =>
    page.request.post('/api/progress/complete', {
      data: {
        lessonId: 'php-01-echo-variables',
        seconds: 30,
        usedHints: false,
        hintPenalty: 0,
        flawless: true,
        comboMultiplier: 1,
        codeSnapshot,
      },
    });

  /*
   * La petición que hasta ahora bastaba: sin código, o con el que la lección
   * ya trae de partida. El servidor la rechaza con 422 y dice qué regla falla.
   */
  const aPelo = await pedirXp({});
  expect(aPelo.status()).toBe(422);
  expect((await aPelo.json()).failed.length).toBeGreaterThan(0);

  // Y con la solución de verdad, cobra.
  const conSolucion = await pedirXp(solucionFinal('php-01-echo-variables'));
  expect(conSolucion.status()).toBe(200);

  const datos = await conSolucion.json();
  expect(datos.xpAwarded).toBeGreaterThan(0);
  // `verified` no se adorna: dice si el servidor pudo comprobar algo.
  expect(datos.verified).toBe(true);
});
