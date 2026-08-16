import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb, type Database } from '@/lib/db/client';
import {
  EventoSchema,
  LoteSchema,
  MAX_LOTE,
  RETENCION_DIAS,
  pruneEvents,
  recordEvents,
  summarize,
  type Evento,
} from '@/lib/observability/events';

/**
 * La telemetría, contra la base de verdad.
 *
 * Lo que se prueba aquí es lo que la hace segura de dejar abierta al mundo:
 * que **el cliente no decide qué se guarda**, que lo que llega se recorta, y
 * que lo guardado se puede agregar para responder a la única pregunta que
 * justifica recogerlo — dónde se atasca la gente y qué se rompe.
 */

async function db(): Promise<Database> {
  return createTestDb();
}

const intento = (extra: Partial<Evento> = {}): Evento =>
  ({
    kind: 'step-attempt',
    lessonId: 'php-01-echo-variables',
    stepIndex: 0,
    passed: false,
    failedRuleIds: ['saluda-por-su-nombre'],
    ...extra,
  }) as Evento;

test('⭐ un tipo de evento que no está en la lista se rechaza', () => {
  const inventado = EventoSchema.safeParse({ kind: 'lo-que-sea', message: 'hola' });
  assert.equal(inventado.success, false, 'la lista de tipos no es una lista');
});

test('⭐ los textos se recortan: el cliente no fija cuánto ocupa una fila', () => {
  const largo = EventoSchema.safeParse({
    kind: 'app-error',
    source: 'window',
    message: 'x'.repeat(5000),
  });

  // No se trunca en silencio: se rechaza. Un mensaje de 5 000 caracteres no es
  // un mensaje, es alguien probando cuánto aguanta la tabla.
  assert.equal(largo.success, false);
});

test('⭐ un lote enorme no pasa entero', () => {
  const lote = LoteSchema.safeParse({ events: Array.from({ length: MAX_LOTE + 5 }, () => intento()) });
  assert.equal(lote.success, false, `se aceptaron más de ${MAX_LOTE} eventos de una vez`);
});

test('⭐ se guarda lo que se pregunta en columnas, no enterrado en el JSON', async () => {
  const base = await db();
  await recordEvents(base, 'anon_1', [intento()]);

  const filas = await base.query.events.findMany();
  assert.equal(filas.length, 1);
  assert.equal(filas[0].kind, 'step-attempt');
  assert.equal(filas[0].lessonId, 'php-01-echo-variables');
  assert.equal(filas[0].stepIndex, 0);
  assert.equal(filas[0].userId, 'anon_1');
  // Y el resto, en el payload: lo que cambia de un tipo a otro.
  assert.deepEqual(filas[0].payload.failedRuleIds, ['saluda-por-su-nombre']);
});

test('⭐ un evento sin sesión también se guarda', async () => {
  const base = await db();
  await recordEvents(base, null, [
    { kind: 'app-error', source: 'window', message: 'Boom' } as Evento,
  ]);

  const [fila] = await base.query.events.findMany();
  // Un error de alguien que ni llegó a jugar sigue siendo un error que ver.
  assert.equal(fila.userId, null);
  assert.equal(fila.kind, 'app-error');
});

test('⭐ el resumen señala el paso donde más se falla y por qué regla', async () => {
  const base = await db();

  // Dos pasos: uno que casi nadie supera y otro que casi todos.
  await recordEvents(base, 'anon_1', [
    intento({ passed: false, failedRuleIds: ['usa-la-variable'] }),
    intento({ passed: false, failedRuleIds: ['usa-la-variable'] }),
    intento({ passed: false, failedRuleIds: ['otra-regla'] }),
    intento({ passed: true, failedRuleIds: [] }),
    intento({ stepIndex: 1, passed: true, failedRuleIds: [] }),
    intento({ stepIndex: 1, passed: true, failedRuleIds: [] }),
  ]);

  const resumen = await summarize(base, 7);
  const peor = resumen.pasosDuros[0];

  assert.equal(peor.stepIndex, 0, 'el paso más duro no es el primero de la lista');
  assert.equal(peor.intentos, 4);
  assert.equal(peor.superados, 1);
  // La regla que más veces falla es la pista de qué reescribir del enunciado.
  assert.equal(peor.reglaMasFallada, 'usa-la-variable');
});

test('⭐ el resumen agrupa los errores repetidos en vez de listarlos', async () => {
  const base = await db();
  const error = (message: string): Evento =>
    ({ kind: 'app-error', source: 'window', message }) as Evento;

  await recordEvents(base, 'anon_1', [error('Boom'), error('Boom'), error('Otro')]);

  const resumen = await summarize(base, 7);
  assert.equal(resumen.totalEventos, 3);
  assert.deepEqual(
    resumen.errores.map((e) => [e.message, e.veces]),
    [
      ['Boom', 2],
      ['Otro', 1],
    ],
  );
});

test('⭐ lo viejo se borra: la tabla no puede crecer para siempre', async () => {
  const base = await db();
  await recordEvents(base, 'anon_1', [intento(), intento({ stepIndex: 1 })]);

  // Se envejecen las filas a mano en vez de esperar un mes.
  const futuro = new Date(Date.now() + (RETENCION_DIAS + 1) * 86_400_000);
  await pruneEvents(base, futuro);

  assert.equal((await base.query.events.findMany()).length, 0);
});

test('la poda respeta lo reciente', async () => {
  const base = await db();
  await recordEvents(base, 'anon_1', [intento()]);

  await pruneEvents(base, new Date());
  assert.equal((await base.query.events.findMany()).length, 1);
});
