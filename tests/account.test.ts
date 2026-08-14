import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb, type Database } from '@/lib/db/client';
import { completeLesson, ensureUser, getStats, saveProgress, unlockAchievements } from '@/lib/db/queries';
import {
  authenticate,
  claimAccount,
  getAccount,
  hasProgress,
  mergeAccounts,
  resetWithRecoveryCode,
} from '@/lib/auth/account';
import {
  generateRecoveryCode,
  hashSecret,
  normalizeRecoveryCode,
  verifySecret,
} from '@/lib/auth/password';
import { clearFailures, isThrottled, recordFailure, resetThrottle } from '@/lib/auth/throttle';

/**
 * Reclamar la cuenta anónima.
 *
 * Lo que se prueba es la promesa: **que no se pierda nada**. Que reclamar
 * conserve el mismo id y con él todo el progreso, que entrar desde otro sitio
 * traiga lo jugado sin cuenta, y que traerlo no pague dos veces las mismas
 * lecciones. Lo demás —hashes, enumeración, freno— es lo que impide que la
 * cuenta sea de otro.
 */

const CLAVE = 'contraseña-larga-1';

async function freshDb(): Promise<Database> {
  resetThrottle();
  return createTestDb();
}

async function conProgreso(db: Database, userId: string, lessonId: string, xp: number) {
  await ensureUser(db, userId);
  await saveProgress(db, {
    userId,
    lessonId,
    track: 'frontend',
    module: 'javascript',
    stepIndex: 1,
    hintsUsed: 0,
    damageTaken: 0,
    codeSnapshot: { 'main.js': '// ' + lessonId },
  });
  await completeLesson(db, {
    userId,
    lessonId,
    track: 'frontend',
    module: 'javascript',
    xpAwarded: xp,
    seconds: 60,
    flawless: true,
    usedHints: false,
  });
}

test('el hash verifica su propia contraseña y rechaza cualquier otra', async () => {
  const hash = await hashSecret(CLAVE);

  assert.equal(await verifySecret(CLAVE, hash), true);
  assert.equal(await verifySecret(CLAVE + 'x', hash), false);
  assert.equal(await verifySecret(CLAVE, null), false);
  // Un hash con formato ajeno no debe reventar: se rechaza y ya.
  assert.equal(await verifySecret(CLAVE, 'no-es-un-hash'), false);
});

test('la contraseña nunca aparece en el hash', async () => {
  const hash = await hashSecret(CLAVE);
  assert.ok(!hash.includes(CLAVE));
  // Los parámetros van dentro para poder subir el coste sin caducar lo guardado.
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
});

test('dos hashes de la misma contraseña son distintos (sal por hash)', async () => {
  const [a, b] = await Promise.all([hashSecret(CLAVE), hashSecret(CLAVE)]);
  assert.notEqual(a, b);
});

test('el código de recuperación evita los caracteres que se confunden', () => {
  for (let i = 0; i < 50; i++) {
    const codigo = generateRecoveryCode();
    assert.match(codigo, /^[2-9A-HJ-NP-TV-Z]{4}(-[2-9A-HJ-NP-TV-Z]{4}){3}$/);
    // Se acepta tecleado a mano, en minúsculas y sin guiones.
    assert.equal(normalizeRecoveryCode(codigo.toLowerCase()), codigo.replace(/-/g, ''));
  }
});

test('reclamar conserva el id, y con él todo el progreso', async () => {
  const db = await freshDb();
  await conProgreso(db, 'anon_1', 'js-01-variables', 145);

  const resultado = await claimAccount(db, 'anon_1', { email: 'Yo@Ejemplo.COM', password: CLAVE });
  assert.equal(resultado.ok, true);

  const cuenta = await getAccount(db, 'anon_1');
  // El correo se guarda normalizado: si no, «Yo@» y «yo@» serían dos cuentas.
  assert.equal(cuenta?.email, 'yo@ejemplo.com');
  assert.equal(cuenta?.anonymous, false);

  // Lo que importa: el progreso sigue donde estaba, porque el id no cambió.
  assert.equal(await hasProgress(db, 'anon_1'), true);
  assert.equal((await getStats(db, 'anon_1'))?.totalXp, 145);
});

test('no se reclama dos veces: cambiaría la contraseña sin pedir la anterior', async () => {
  const db = await freshDb();
  await ensureUser(db, 'anon_1');
  await claimAccount(db, 'anon_1', { email: 'yo@ejemplo.com', password: CLAVE });

  const segundo = await claimAccount(db, 'anon_1', { email: 'otro@ejemplo.com', password: 'otra-clave-larga' });
  assert.deepEqual(segundo, { ok: false, error: 'not-anonymous' });
});

test('dos cuentas no comparten correo', async () => {
  const db = await freshDb();
  await ensureUser(db, 'anon_1');
  await ensureUser(db, 'anon_2');

  await claimAccount(db, 'anon_1', { email: 'yo@ejemplo.com', password: CLAVE });
  const choque = await claimAccount(db, 'anon_2', { email: 'YO@ejemplo.com', password: CLAVE });

  assert.deepEqual(choque, { ok: false, error: 'email-taken' });
  assert.equal((await getAccount(db, 'anon_2'))?.anonymous, true);
});

test('una contraseña corta o un correo inválido se rechazan antes de tocar nada', async () => {
  const db = await freshDb();
  await ensureUser(db, 'anon_1');

  assert.deepEqual(await claimAccount(db, 'anon_1', { email: 'yo@ejemplo.com', password: 'corta' }), {
    ok: false,
    error: 'weak-password',
  });
  assert.deepEqual(await claimAccount(db, 'anon_1', { email: 'no-es-correo', password: CLAVE }), {
    ok: false,
    error: 'invalid-email',
  });
  assert.equal((await getAccount(db, 'anon_1'))?.anonymous, true);
});

test('entrar exige la contraseña correcta', async () => {
  const db = await freshDb();
  await ensureUser(db, 'anon_1');
  await claimAccount(db, 'anon_1', { email: 'yo@ejemplo.com', password: CLAVE });

  assert.deepEqual(await authenticate(db, { email: ' YO@ejemplo.com ', password: CLAVE }), {
    ok: true,
    userId: 'anon_1',
  });
  assert.deepEqual(await authenticate(db, { email: 'yo@ejemplo.com', password: 'otra-cosa-larga' }), {
    ok: false,
    error: 'bad-credentials',
  });
});

test('un correo desconocido da el MISMO error que una contraseña mala', async () => {
  const db = await freshDb();
  await ensureUser(db, 'anon_1');
  await claimAccount(db, 'anon_1', { email: 'yo@ejemplo.com', password: CLAVE });

  const desconocido = await authenticate(db, { email: 'nadie@ejemplo.com', password: CLAVE });
  const malaClave = await authenticate(db, { email: 'yo@ejemplo.com', password: 'otra-cosa-larga' });

  // Distinguirlos convierte el formulario en un buscador de qué correos existen.
  assert.deepEqual(desconocido, malaClave);
});

test('el código de recuperación cambia la contraseña y se gasta', async () => {
  const db = await freshDb();
  await ensureUser(db, 'anon_1');
  const claim = await claimAccount(db, 'anon_1', { email: 'yo@ejemplo.com', password: CLAVE });
  assert.ok(claim.ok);

  const reset = await resetWithRecoveryCode(db, {
    email: 'yo@ejemplo.com',
    // Tecleado a mano: minúsculas y sin guiones, como lo escribiría cualquiera.
    code: claim.recoveryCode.toLowerCase().replace(/-/g, ''),
    password: 'clave-nueva-larga',
  });
  assert.ok(reset.ok);
  assert.notEqual(reset.recoveryCode, claim.recoveryCode);

  assert.equal((await authenticate(db, { email: 'yo@ejemplo.com', password: 'clave-nueva-larga' })).ok, true);
  assert.equal((await authenticate(db, { email: 'yo@ejemplo.com', password: CLAVE })).ok, false);

  // El código usado ya no vale: si se usó, es que circuló por algún sitio.
  const repetido = await resetWithRecoveryCode(db, {
    email: 'yo@ejemplo.com',
    code: claim.recoveryCode,
    password: 'otra-mas-larga-aun',
  });
  assert.deepEqual(repetido, { ok: false, error: 'bad-credentials' });
});

test('entrar trae lo jugado sin cuenta, sin pagar dos veces lo repetido', async () => {
  const db = await freshDb();

  // La cuenta de siempre: una lección terminada.
  await conProgreso(db, 'user_casa', 'js-01-variables', 145);
  await claimAccount(db, 'user_casa', { email: 'yo@ejemplo.com', password: CLAVE });

  // Y un rato jugado en otro navegador sin cuenta: una repetida y una nueva.
  await conProgreso(db, 'anon_trabajo', 'js-01-variables', 145);
  await conProgreso(db, 'anon_trabajo', 'js-02-funciones', 100);
  await unlockAchievements(db, 'anon_trabajo', ['primera-sangre']);

  // Solo viaja la nueva: la repetida ya estaba igual de avanzada en destino.
  const fusion = await mergeAccounts(db, 'anon_trabajo', 'user_casa');
  assert.equal(fusion.lessons, 1);

  // La nueva llega; la repetida no se paga otra vez.
  assert.equal((await getStats(db, 'user_casa'))?.totalXp, 245);
  assert.equal(await hasProgress(db, 'user_casa'), true);

  // Y la cuenta anónima desaparece: sus filas ya no las alcanza nadie.
  assert.equal(await getAccount(db, 'anon_trabajo'), null);
});

test('al fusionar, una lección terminada nunca cede ante una a medias', async () => {
  const db = await freshDb();

  await conProgreso(db, 'user_casa', 'js-01-variables', 145);
  await claimAccount(db, 'user_casa', { email: 'yo@ejemplo.com', password: CLAVE });

  // En el otro navegador la misma lección se dejó a medias.
  await ensureUser(db, 'anon_trabajo');
  await saveProgress(db, {
    userId: 'anon_trabajo',
    lessonId: 'js-01-variables',
    track: 'frontend',
    module: 'javascript',
    stepIndex: 0,
    hintsUsed: 3,
    damageTaken: 20,
    codeSnapshot: { 'main.js': '// a medias' },
  });

  await mergeAccounts(db, 'anon_trabajo', 'user_casa');

  // Volver a entrar no puede castigar: el XP sigue ahí.
  assert.equal((await getStats(db, 'user_casa'))?.totalXp, 145);
});

test('una cuenta con dueño no se absorbe', async () => {
  const db = await freshDb();
  await conProgreso(db, 'user_a', 'js-01-variables', 145);
  await claimAccount(db, 'user_a', { email: 'a@ejemplo.com', password: CLAVE });
  await ensureUser(db, 'user_b');
  await claimAccount(db, 'user_b', { email: 'b@ejemplo.com', password: CLAVE });

  const fusion = await mergeAccounts(db, 'user_a', 'user_b');

  // Fundir dos cuentas con dueño sería decidir por ellas cuál desaparece.
  assert.deepEqual(fusion, { lessons: 0, achievements: 0 });
  assert.equal((await getAccount(db, 'user_a'))?.email, 'a@ejemplo.com');
});

test('el freno corta tras varios fallos y el acierto lo limpia', () => {
  resetThrottle();
  const clave = 'login:yo@ejemplo.com';

  for (let i = 0; i < 8; i++) {
    assert.equal(isThrottled(clave), false, `bloqueado en el intento ${i + 1}`);
    recordFailure(clave);
  }
  assert.equal(isThrottled(clave), true);

  clearFailures(clave);
  assert.equal(isThrottled(clave), false);
});

test('el freno olvida los fallos viejos', () => {
  resetThrottle();
  const ahora = Date.now();
  for (let i = 0; i < 8; i++) recordFailure('login:yo@ejemplo.com', ahora);

  assert.equal(isThrottled('login:yo@ejemplo.com', ahora), true);
  // Quien falló hace media hora no arrastra el castigo para siempre.
  assert.equal(isThrottled('login:yo@ejemplo.com', ahora + 31 * 60_000), false);
});
