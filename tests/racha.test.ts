import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDb, type Database } from '@/lib/db/client';
import { ensureUser, rememberTimeZone, touchStreak, zonaDelUsuario } from '@/lib/db/queries';
import { ZONA_POR_DEFECTO, diaAnterior, esZonaValida, localDay } from '@/lib/game/day';

/**
 * La racha, en el calendario del usuario.
 *
 * Cortaba a medianoche **UTC**, que en México es a las seis de la tarde: jugar
 * a las siete contaba como el día siguiente. Es un fallo que solo sufre quien
 * no vive en Londres, y que quien lo escribió no ve nunca — por eso los tests
 * de aquí se escriben desde fuera de UTC a propósito.
 */

const USER = 'anon_racha';

async function baseConUsuario(zona?: string): Promise<Database> {
  const db = await createTestDb();
  await ensureUser(db, USER);
  if (zona) await rememberTimeZone(db, USER, zona);
  return db;
}

test('⭐ a las 19:00 en México sigue siendo hoy, no mañana', () => {
  // 2026-03-01 19:00 en Ciudad de México son las 01:00 UTC del día 2.
  const instante = new Date('2026-03-02T01:00:00Z');

  assert.equal(localDay('America/Mexico_City', instante), '2026-03-01');
  // Y en UTC ya es otro día: esa diferencia era exactamente el fallo.
  assert.equal(localDay('UTC', instante), '2026-03-02');
});

test('⭐ y a las 08:00 en Madrid también es el día que el usuario ve', () => {
  const instante = new Date('2026-07-15T06:00:00Z'); // 08:00 en Madrid (verano)
  assert.equal(localDay('Europe/Madrid', instante), '2026-07-15');
});

test('⭐ el horario de verano lo resuelve la zona, no una resta de minutos', () => {
  // Santiago de Chile: el mismo desfase nominal cambia entre enero y julio.
  const enero = new Date('2026-01-15T02:30:00Z');
  const julio = new Date('2026-07-15T02:30:00Z');

  assert.equal(localDay('America/Santiago', enero), '2026-01-14');
  assert.equal(localDay('America/Santiago', julio), '2026-07-14');
});

test('una zona inventada no rompe nada: se cae a UTC', () => {
  assert.equal(esZonaValida('Marte/Olympus'), false);
  assert.equal(localDay('Marte/Olympus', new Date('2026-03-02T01:00:00Z')), '2026-03-02');
  assert.equal(ZONA_POR_DEFECTO, 'UTC');
});

test('el día anterior sobrevive a los cambios de hora', () => {
  assert.equal(diaAnterior('2026-03-02'), '2026-03-01');
  assert.equal(diaAnterior('2026-01-01'), '2025-12-31');
  // 2026 no es bisiesto; 2028 sí.
  assert.equal(diaAnterior('2028-03-01'), '2028-02-29');
});

test('⭐ dos sesiones en la misma tarde-noche cuentan como un día', async () => {
  const db = await baseConUsuario('America/Mexico_City');

  // 17:00 local del día 1, y 20:00 local del mismo día (ya día 2 en UTC).
  const antes = await touchStreak(db, USER, localDay('America/Mexico_City', new Date('2026-03-01T23:00:00Z')));
  const despues = await touchStreak(db, USER, localDay('America/Mexico_City', new Date('2026-03-02T02:00:00Z')));

  assert.equal(antes.streakDays, 1);
  assert.equal(despues.streakDays, 1, 'la misma noche contó como dos días');
  assert.equal(despues.changed, false);
});

test('⭐ la racha usa la zona guardada aunque la petición no la traiga', async () => {
  const db = await baseConUsuario('America/Mexico_City');
  assert.equal(await zonaDelUsuario(db, USER), 'America/Mexico_City');

  /*
   * Sin día explícito: es como se llama desde la portada y el mapa, que no
   * saben nada del navegador. Si ahí se calculara en UTC, la misma racha se
   * vería distinta según la pantalla desde la que se mirase.
   */
  const resultado = await touchStreak(db, USER);
  assert.equal(resultado.streakDays, 1);

  const hoyEnMexico = localDay('America/Mexico_City');
  assert.equal((await touchStreak(db, USER, hoyEnMexico)).changed, false);
});

test('⭐ días consecutivos suman y un hueco vuelve a 1', async () => {
  const db = await baseConUsuario('America/Mexico_City');

  assert.equal((await touchStreak(db, USER, '2026-03-01')).streakDays, 1);
  assert.equal((await touchStreak(db, USER, '2026-03-02')).streakDays, 2);
  assert.equal((await touchStreak(db, USER, '2026-03-03')).streakDays, 3);

  // Se salta el 4: la racha empieza de nuevo, y hoy ya cuenta.
  assert.equal((await touchStreak(db, USER, '2026-03-05')).streakDays, 1);
});

test('⭐ viajar no rompe la racha', async () => {
  const db = await baseConUsuario('Europe/Madrid');
  await touchStreak(db, USER, '2026-03-01');

  // Al día siguiente el usuario aterriza en México y su navegador lo declara.
  await rememberTimeZone(db, USER, 'America/Mexico_City');
  const resultado = await touchStreak(db, USER, '2026-03-02');

  assert.equal(resultado.streakDays, 2, 'cambiar de zona no puede costar la racha');
});

test('una zona inventada no se guarda', async () => {
  const db = await baseConUsuario('Europe/Madrid');
  await rememberTimeZone(db, USER, 'Marte/Olympus');

  // Se conserva la última válida en vez de dejar el usuario sin zona.
  assert.equal(await zonaDelUsuario(db, USER), 'Europe/Madrid');
});
