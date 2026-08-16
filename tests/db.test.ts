import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb, DDL, type Database } from '@/lib/db/client';
import {
  buildPlayerStats,
  completeLesson,
  ensureUser,
  getStats,
  getUnlockedIds,
  loadProgress,
  saveProgress,
  syncCounters,
  touchStreak,
  unlockAchievements,
  utcDay,
} from '@/lib/db/queries';
import { parseSession, serializeSession } from '@/lib/auth/session';

/**
 * Tests contra Postgres de verdad (PGlite en WASM). No son mocks: se ejercitan
 * las claves primarias compuestas, los `ON CONFLICT`, `GREATEST`/`LEAST` y los
 * tipos `jsonb` exactamente como en producción.
 */

const USER = 'anon_test_1';

async function freshDb(): Promise<Database> {
  const db = await createTestDb();
  await ensureUser(db, USER);
  return db;
}

test('ensureUser es idempotente y crea las estadísticas', async () => {
  const db = await freshDb();
  await ensureUser(db, USER);
  await ensureUser(db, USER);

  const stats = await getStats(db, USER);
  assert.ok(stats);
  assert.equal(stats.totalXp, 0);
  assert.equal(stats.level, 1);
});

/* ── Autosave ────────────────────────────────────────────────────── */

test('⭐ el autosave permite reanudar exactamente donde se dejó', async () => {
  const db = await freshDb();
  const snapshot = { 'index.js': 'const withTax = prices.map((p) => p * 1.21);' };

  await saveProgress(db, {
    userId: USER, lessonId: 'js-03-array-map', track: 'frontend', module: 'javascript',
    stepIndex: 0, hintsUsed: 1, damageTaken: 2, codeSnapshot: snapshot,
  });

  const row = await loadProgress(db, USER, 'js-03-array-map');
  assert.equal(row?.stepIndex, 0);
  assert.equal(row?.hintsUsed, 1);
  assert.deepEqual(row?.codeSnapshot, snapshot, 'el buffer vuelve tal cual');
});

test('guardar dos veces actualiza en vez de duplicar, y cuenta intentos', async () => {
  const db = await freshDb();
  const base = {
    userId: USER, lessonId: 'js-01-variables', track: 'frontend', module: 'javascript',
    hintsUsed: 0, damageTaken: 0, codeSnapshot: {},
  };

  await saveProgress(db, { ...base, stepIndex: 0 });
  await saveProgress(db, { ...base, stepIndex: 1 });

  const row = await loadProgress(db, USER, 'js-01-variables');
  assert.equal(row?.stepIndex, 1);
  assert.equal(row?.attempts, 1, 'el segundo guardado incrementa attempts');
});

/* ── XP y anti-duplicado ─────────────────────────────────────────── */

test('⭐ completar una lección concede XP UNA sola vez', async () => {
  const db = await freshDb();
  const input = {
    userId: USER, lessonId: 'js-03-array-map', track: 'frontend', module: 'javascript',
    xpAwarded: 150, seconds: 200, flawless: true, usedHints: false,
  };

  const first = await completeLesson(db, input);
  assert.equal(first.xpAwarded, 150);
  assert.equal(first.alreadyCompleted, false);

  // Recargar la página tras terminar no puede ser una máquina de XP infinito.
  const second = await completeLesson(db, input);
  assert.equal(second.xpAwarded, 0);
  assert.equal(second.alreadyCompleted, true);

  const stats = await getStats(db, USER);
  assert.equal(stats?.totalXp, 150, 'el total no se dobla');
});

test('el nivel se recalcula al ganar XP', async () => {
  const db = await freshDb();
  await completeLesson(db, {
    userId: USER, lessonId: 'a', track: 'frontend', module: 'javascript',
    xpAwarded: 900, seconds: 100, flawless: false, usedHints: true,
  });

  const stats = await getStats(db, USER);
  assert.ok((stats?.level ?? 0) > 1, `nivel esperado > 1, fue ${stats?.level}`);
});

test('repetir una lección conserva el mejor tiempo', async () => {
  const db = await freshDb();
  const base = {
    userId: USER, lessonId: 'a', track: 'frontend', module: 'javascript',
    xpAwarded: 100, flawless: false, usedHints: false,
  };

  await completeLesson(db, { ...base, seconds: 300 });
  await completeLesson(db, { ...base, seconds: 120 });

  const row = await loadProgress(db, USER, 'a');
  assert.equal(row?.bestTimeMs, 120_000, 'se queda el tiempo menor');
});

test('la racha sin fallos se rompe al recibir daño', async () => {
  const db = await freshDb();
  const base = { userId: USER, track: 'frontend', module: 'javascript', xpAwarded: 10, seconds: 60, usedHints: false };

  await completeLesson(db, { ...base, lessonId: 'a', flawless: true });
  await completeLesson(db, { ...base, lessonId: 'b', flawless: true });
  assert.equal((await getStats(db, USER))?.flawlessStreak, 2);

  await completeLesson(db, { ...base, lessonId: 'c', flawless: false });
  assert.equal((await getStats(db, USER))?.flawlessStreak, 0, 'un fallo la reinicia');
});

/* ── Contadores ──────────────────────────────────────────────────── */

test('⭐ los contadores solo suben: un cliente obsoleto no puede bajarlos', async () => {
  const db = await freshDb();

  await syncCounters(db, USER, { keystrokes: 5000, bestCombo: 80 });
  await syncCounters(db, USER, { keystrokes: 10, bestCombo: 2 });

  const stats = await getStats(db, USER);
  assert.equal(stats?.totalKeystrokes, 5000);
  assert.equal(stats?.bestCombo, 80);
});

/* ── Racha diaria ────────────────────────────────────────────────── */

test('la racha diaria cuenta días consecutivos y se corta con un hueco', async () => {
  const db = await freshDb();

  const first = await touchStreak(db, USER, '2026-03-01');
  assert.equal(first.streakDays, 1);

  // El mismo día no suma dos veces.
  assert.equal((await touchStreak(db, USER, '2026-03-01')).streakDays, 1);

  assert.equal((await touchStreak(db, USER, '2026-03-02')).streakDays, 2);
  assert.equal((await touchStreak(db, USER, '2026-03-03')).streakDays, 3);

  // Un día de hueco vuelve a 1, no a 0: hoy ya cuenta.
  assert.equal((await touchStreak(db, USER, '2026-03-05')).streakDays, 1);
});

test('utcDay produce el formato esperado', () => {
  assert.equal(utcDay(new Date('2026-03-01T23:30:00Z')), '2026-03-01');
});

/* ── Logros ──────────────────────────────────────────────────────── */

test('desbloquear un logro dos veces no lo duplica', async () => {
  const db = await freshDb();

  const first = await unlockAchievements(db, USER, ['first-steps', 'syntax-ninja']);
  assert.deepEqual(first.sort(), ['first-steps', 'syntax-ninja']);

  const second = await unlockAchievements(db, USER, ['first-steps', 'coding-spree']);
  assert.deepEqual(second, ['coding-spree'], 'solo el nuevo');

  const all = await getUnlockedIds(db, USER);
  assert.equal(all.length, 3);
});

test('⭐ un módulo cuenta como completo solo con TODAS sus lecciones', async () => {
  const db = await freshDb();
  const base = { userId: USER, track: 'frontend', module: 'javascript', xpAwarded: 10, seconds: 60, flawless: false, usedHints: false };

  await completeLesson(db, { ...base, lessonId: 'js-01' });
  await completeLesson(db, { ...base, lessonId: 'js-02' });

  // El servidor sabe que el módulo tiene 3: el cliente no podría decidirlo.
  let stats = await buildPlayerStats(db, USER, { javascript: 3 });
  assert.deepEqual(stats.completedModules, [], '2 de 3 no basta');

  await completeLesson(db, { ...base, lessonId: 'js-03' });
  stats = await buildPlayerStats(db, USER, { javascript: 3 });
  assert.deepEqual(stats.completedModules, ['javascript']);
  assert.equal(stats.completedByTrack.frontend, 3);
});

/* ── Sesión firmada ──────────────────────────────────────────────── */

test('⭐ la cookie de sesión detecta manipulación', () => {
  const token = serializeSession('anon_abc');
  assert.equal(parseSession(token), 'anon_abc');

  // Cambiar el id sin recalcular la firma debe rechazarse: si no, bastaría
  // editar la cookie en devtools para suplantar a otro usuario.
  const tampered = token.replace('anon_abc', 'anon_victim');
  assert.equal(parseSession(tampered), null);

  assert.equal(parseSession('sin-punto'), null);
  assert.equal(parseSession(undefined), null);
  assert.equal(parseSession('anon_abc.firmafalsa'), null);
});

/* ── Esquema idempotente ─────────────────────────────────────────── */

test('⭐ aplicar el esquema dos veces no falla', async () => {
  // La aplicación lo ejecuta sola al conectar, y en serverless eso ocurre en
  // cada arranque en frío y desde varias instancias a la vez. Si no fuera
  // idempotente, el segundo arranque tumbaría el servidor.
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();

  await pg.exec(DDL);
  await pg.exec(DDL);
  await pg.exec(DDL);

  const tables = await pg.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
  );

  assert.deepEqual(
    tables.rows.map((row) => row.table_name),
    ['events', 'lesson_progress', 'user_achievements', 'user_stats', 'users'],
  );
});

test('los datos sobreviven a reaplicar el esquema', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  await pg.exec(DDL);

  await pg.exec(`INSERT INTO users (id) VALUES ('anon_persistente')`);
  await pg.exec(DDL);

  const rows = await pg.query<{ id: string }>(`SELECT id FROM users`);
  assert.deepEqual(rows.rows.map((r) => r.id), ['anon_persistente']);
});
