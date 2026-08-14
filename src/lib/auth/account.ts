import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import { lessonProgress, userAchievements, users, userStats } from '@/lib/db/schema';
import { levelFromXp } from '@/lib/game/xp';
import {
  generateRecoveryCode,
  hashSecret,
  normalizeEmail,
  normalizeRecoveryCode,
  verifySecret,
} from './password';

/**
 * Reclamar la cuenta anónima.
 *
 * Hasta aquí el progreso vivía atado a una cookie: borrar los datos del
 * navegador, cambiar de ordenador o abrir el móvil significaba empezar de cero
 * sin aviso. Era la única forma real de perder el trabajo hecho.
 *
 * **Sin correo de verificación, y a propósito.** Mandar correo obliga a
 * contratar un proveedor; el requisito es que la plataforma no cueste nada.
 * Así que el email es un **identificador para volver a entrar**, no un canal
 * verificado: no se usa para nada más y no se le promete al usuario que lo sea.
 * La consecuencia honesta es que no hay «te enviamos un enlace» — por eso al
 * reclamar se entrega un **código de recuperación** que se enseña una vez. Es
 * la única vía de reset, y se dice claramente.
 */

/** Mínimo con criterio: longitud, que es lo único que de verdad correlaciona. */
export const MIN_PASSWORD = 10;

export type AccountError =
  | 'not-anonymous'
  | 'email-taken'
  | 'weak-password'
  | 'invalid-email'
  | 'bad-credentials';

export type AccountSummary = { id: string; email: string | null; anonymous: boolean };

export async function getAccount(db: Database, userId: string): Promise<AccountSummary | null> {
  const [row] = await db
    .select({ id: users.id, email: users.email, anonymous: users.anonymous })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

/**
 * Convierte la cuenta anónima actual en una con email y contraseña.
 *
 * **Conserva el mismo `id`**: no se copia nada ni se crea un usuario nuevo, así
 * que no hay ningún momento en que el progreso pueda quedarse a medio camino.
 * Era justo para esto que `users.email` nació opcional.
 */
export async function claimAccount(
  db: Database,
  userId: string,
  input: { email: string; password: string },
): Promise<{ ok: true; recoveryCode: string } | { ok: false; error: AccountError }> {
  const email = normalizeEmail(input.email);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'invalid-email' };
  if (input.password.length < MIN_PASSWORD) return { ok: false, error: 'weak-password' };

  const actual = await getAccount(db, userId);
  // Reclamar una cuenta ya reclamada cambiaría la contraseña sin pedir la
  // anterior: quien se siente en una sesión abierta se quedaría con ella.
  if (!actual || !actual.anonymous) return { ok: false, error: 'not-anonymous' };

  const recoveryCode = generateRecoveryCode();
  const [passwordHash, recoveryHash] = await Promise.all([
    hashSecret(input.password),
    hashSecret(normalizeRecoveryCode(recoveryCode)),
  ]);

  try {
    await db
      .update(users)
      .set({ email, passwordHash, recoveryHash, anonymous: false })
      .where(eq(users.id, userId));
  } catch {
    // El índice único de `email` es quien decide, no una consulta previa: entre
    // el `SELECT` y el `UPDATE` cabe otro registro con el mismo correo.
    return { ok: false, error: 'email-taken' };
  }

  return { ok: true, recoveryCode };
}

/**
 * Comprueba email y contraseña.
 *
 * Devuelve el mismo error cuando el correo no existe y cuando la contraseña
 * falla. Distinguirlos convierte el formulario en un buscador de qué correos
 * están registrados aquí.
 */
export async function authenticate(
  db: Database,
  input: { email: string; password: string },
): Promise<{ ok: true; userId: string } | { ok: false; error: 'bad-credentials' }> {
  const email = normalizeEmail(input.email);
  const [row] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email));

  /*
   * Sin usuario también se calcula un hash. Verificar cuesta ~50 ms y no
   * hacerlo cuando el correo no existe responde en 1 ms: esa diferencia es un
   * oráculo que dice qué correos están dados de alta, aunque el mensaje sea
   * idéntico.
   */
  const ok = await verifySecret(input.password, row?.passwordHash ?? null);
  if (!row || !ok) return { ok: false, error: 'bad-credentials' };

  return { ok: true, userId: row.id };
}

/** Cambia la contraseña con el código de recuperación. Devuelve uno nuevo. */
export async function resetWithRecoveryCode(
  db: Database,
  input: { email: string; code: string; password: string },
): Promise<{ ok: true; userId: string; recoveryCode: string } | { ok: false; error: AccountError }> {
  if (input.password.length < MIN_PASSWORD) return { ok: false, error: 'weak-password' };

  const [row] = await db
    .select({ id: users.id, recoveryHash: users.recoveryHash })
    .from(users)
    .where(eq(users.email, normalizeEmail(input.email)));

  const ok = await verifySecret(normalizeRecoveryCode(input.code), row?.recoveryHash ?? null);
  if (!row || !ok) return { ok: false, error: 'bad-credentials' };

  // El código gastado deja de valer: si se usó, ya circuló por algún sitio.
  const recoveryCode = generateRecoveryCode();
  const [passwordHash, recoveryHash] = await Promise.all([
    hashSecret(input.password),
    hashSecret(normalizeRecoveryCode(recoveryCode)),
  ]);

  await db.update(users).set({ passwordHash, recoveryHash }).where(eq(users.id, row.id));

  return { ok: true, userId: row.id, recoveryCode };
}

/**
 * Absorbe el progreso de una cuenta anónima dentro de otra, y la borra.
 *
 * El caso: alguien juega un rato en el portátil del trabajo sin cuenta y luego
 * inicia sesión con la suya. Sin esto, ese rato desaparece de la vista en el
 * instante en que la cookie cambia de dueño — que es exactamente la pérdida
 * silenciosa que este trabajo venía a eliminar.
 *
 * Por lección se queda **la mejor de las dos**, no la más reciente: terminada
 * gana a en curso, y entre dos iguales gana la que llegó más lejos. Volver a
 * entrar no puede castigar.
 *
 * El XP no se suma: se **recalcula** como la suma del XP de las lecciones que
 * quedan. Sumar los dos totales pagaría dos veces las lecciones hechas en
 * ambas cuentas, y la regla de la casa es que una lección paga una vez.
 */
export async function mergeAccounts(db: Database, fromUserId: string, intoUserId: string) {
  if (fromUserId === intoUserId) return { lessons: 0, achievements: 0 };

  const origen = await getAccount(db, fromUserId);
  // Solo se absorben cuentas anónimas: fundir dos cuentas con dueño sería
  // decidir por ellas cuál desaparece.
  if (!origen || !origen.anonymous) return { lessons: 0, achievements: 0 };

  const filas = await db.select().from(lessonProgress).where(eq(lessonProgress.userId, fromUserId));

  let lessons = 0;
  for (const fila of filas) {
    const [destino] = await db
      .select()
      .from(lessonProgress)
      .where(
        and(eq(lessonProgress.userId, intoUserId), eq(lessonProgress.lessonId, fila.lessonId)),
      );

    if (destino && !mejor(fila, destino)) continue;

    await db
      .insert(lessonProgress)
      .values({ ...fila, userId: intoUserId })
      .onConflictDoUpdate({
        target: [lessonProgress.userId, lessonProgress.lessonId],
        set: {
          status: fila.status,
          stepIndex: fila.stepIndex,
          xpEarned: fila.xpEarned,
          hintsUsed: fila.hintsUsed,
          attempts: fila.attempts,
          damageTaken: fila.damageTaken,
          bestTimeMs: fila.bestTimeMs,
          codeSnapshot: fila.codeSnapshot,
          updatedAt: new Date(),
        },
      });
    lessons++;
  }

  const logros = await db
    .select({ id: userAchievements.achievementId })
    .from(userAchievements)
    .where(eq(userAchievements.userId, fromUserId));

  if (logros.length > 0) {
    await db
      .insert(userAchievements)
      .values(logros.map((logro) => ({ userId: intoUserId, achievementId: logro.id })))
      .onConflictDoNothing();
  }

  // Los contadores acumulativos sí se quedan con el mayor de los dos: son
  // marcas personales, no moneda. Se resuelven en JS y no en SQL porque el
  // mejor tiempo puede ser nulo en cualquiera de los dos lados, y un `COALESCE`
  // con un parámetro nulo deja a Postgres sin saber de qué tipo hablamos.
  const [origenStats] = await db.select().from(userStats).where(eq(userStats.userId, fromUserId));
  const [destinoStats] = await db.select().from(userStats).where(eq(userStats.userId, intoUserId));

  if (origenStats && destinoStats) {
    const tiempos = [origenStats.fastestClearSeconds, destinoStats.fastestClearSeconds].filter(
      (valor): valor is number => valor !== null,
    );

    await db
      .update(userStats)
      .set({
        totalKeystrokes: Math.max(origenStats.totalKeystrokes, destinoStats.totalKeystrokes),
        bestCombo: Math.max(origenStats.bestCombo, destinoStats.bestCombo),
        flawlessStreak: Math.max(origenStats.flawlessStreak, destinoStats.flawlessStreak),
        noHintLessons: Math.max(origenStats.noHintLessons, destinoStats.noHintLessons),
        streakDays: Math.max(origenStats.streakDays, destinoStats.streakDays),
        fastestClearSeconds: tiempos.length > 0 ? Math.min(...tiempos) : null,
        updatedAt: new Date(),
      })
      .where(eq(userStats.userId, intoUserId));
  }

  await recalcXp(db, intoUserId);

  // La cuenta vacía se borra: dejarla suelta acumula filas que nadie puede
  // alcanzar ya, porque su única llave era la cookie que acaba de cambiar.
  await db.delete(users).where(and(eq(users.id, fromUserId), eq(users.anonymous, true)));

  return { lessons, achievements: logros.length };
}

/** ¿Gana `a` a `b`? Terminada > en curso; a igualdad, la que llegó más lejos. */
function mejor(a: { status: string; stepIndex: number }, b: { status: string; stepIndex: number }) {
  if (a.status === b.status) return a.stepIndex > b.stepIndex;
  return a.status === 'completed';
}

/** Reconstruye XP y nivel desde las lecciones. La suma es la fuente de verdad. */
async function recalcXp(db: Database, userId: string) {
  const filas = await db
    .select({ xp: lessonProgress.xpEarned })
    .from(lessonProgress)
    .where(and(eq(lessonProgress.userId, userId), eq(lessonProgress.status, 'completed')));

  const totalXp = filas.reduce((suma, fila) => suma + fila.xp, 0);
  await db
    .update(userStats)
    .set({ totalXp, level: levelFromXp(totalXp).level, updatedAt: new Date() })
    .where(eq(userStats.userId, userId));
}

/** ¿Tiene esta cuenta algo que perder? Decide si se ofrece fusionar. */
export async function hasProgress(db: Database, userId: string): Promise<boolean> {
  const filas = await db
    .select({ id: lessonProgress.lessonId })
    .from(lessonProgress)
    .where(eq(lessonProgress.userId, userId))
    .limit(1);
  return filas.length > 0;
}
