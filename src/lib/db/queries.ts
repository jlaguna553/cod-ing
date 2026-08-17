import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client';
import { lessonProgress, userAchievements, users, userStats } from './schema';
import type { PlayerStats } from '@/lib/game/achievements';
import { levelFromXp } from '@/lib/game/xp';
import { ZONA_POR_DEFECTO, diaAnterior, esZonaValida, localDay } from '@/lib/game/day';

/** Día UTC en formato YYYY-MM-DD. Solo para lo que no depende del usuario. */
export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/** Crea el usuario y sus estadísticas si no existen. Idempotente. */
export async function ensureUser(db: Database, userId: string, locale = 'es') {
  await db
    .insert(users)
    .values({ id: userId, locale })
    .onConflictDoUpdate({
      target: users.id,
      set: { lastSeenAt: new Date() },
    });

  await db.insert(userStats).values({ userId }).onConflictDoNothing();
}

/**
 * Actualiza la racha diaria, **en el calendario del usuario**.
 *
 * Tres casos: mismo día (no cambia), día consecutivo (+1) y hueco (vuelve a 1,
 * no a 0 — el día de hoy ya cuenta).
 *
 * El corte era medianoche **UTC**, que para quien juega en UTC-6 llega a las
 * seis de la tarde: jugar a las siete contaba como el día siguiente. Ahora el
 * día se calcula en la zona horaria que el navegador declara, y esa zona se
 * guarda para que el cálculo no dependa de que la mande cada petición.
 */
export async function touchStreak(db: Database, userId: string, today?: string) {
  const [current] = await db.select().from(userStats).where(eq(userStats.userId, userId));
  if (!current) return { streakDays: 0, changed: false };

  const dia = today ?? localDay(await zonaDelUsuario(db, userId));

  if (current.lastActiveDay === dia) {
    return { streakDays: current.streakDays, changed: false };
  }

  const ayer = diaAnterior(dia);
  const streakDays = current.lastActiveDay === ayer ? current.streakDays + 1 : 1;

  await db
    .update(userStats)
    .set({ streakDays, lastActiveDay: dia, updatedAt: new Date() })
    .where(eq(userStats.userId, userId));

  return { streakDays, changed: true };
}

/** La última zona horaria que declaró este usuario. */
export async function zonaDelUsuario(db: Database, userId: string): Promise<string> {
  const [row] = await db
    .select({ zona: users.timeZone })
    .from(users)
    .where(eq(users.id, userId));
  return row?.zona ?? ZONA_POR_DEFECTO;
}

/**
 * Recuerda la zona horaria del usuario.
 *
 * Se guarda en vez de exigirla en cada petición porque la racha se consulta
 * también desde sitios que no la conocen —la portada, el mapa—, y un día
 * calculado en UTC ahí y en local aquí daría rachas que bailan según la
 * pantalla desde la que se miren.
 */
export async function rememberTimeZone(db: Database, userId: string, zona: string) {
  if (!esZonaValida(zona)) return;
  await db.update(users).set({ timeZone: zona }).where(eq(users.id, userId));
}

/** Guarda el avance dentro de una lección (autosave). */
export async function saveProgress(
  db: Database,
  input: {
    userId: string;
    lessonId: string;
    track: string;
    module: string;
    stepIndex: number;
    hintsUsed: number;
    damageTaken: number;
    codeSnapshot: Record<string, string>;
  },
) {
  await db
    .insert(lessonProgress)
    .values({
      userId: input.userId,
      lessonId: input.lessonId,
      track: input.track,
      module: input.module,
      stepIndex: input.stepIndex,
      hintsUsed: input.hintsUsed,
      damageTaken: input.damageTaken,
      codeSnapshot: input.codeSnapshot,
    })
    .onConflictDoUpdate({
      target: [lessonProgress.userId, lessonProgress.lessonId],
      set: {
        stepIndex: input.stepIndex,
        hintsUsed: input.hintsUsed,
        damageTaken: input.damageTaken,
        codeSnapshot: input.codeSnapshot,
        attempts: sql`${lessonProgress.attempts} + 1`,
        updatedAt: new Date(),
      },
    });
}

export async function loadProgress(db: Database, userId: string, lessonId: string) {
  const [row] = await db
    .select()
    .from(lessonProgress)
    .where(and(eq(lessonProgress.userId, userId), eq(lessonProgress.lessonId, lessonId)));
  return row ?? null;
}

/**
 * Marca una lección como completada y concede el XP.
 *
 * ⚠️ **El XP se calcula aquí, con los datos de la lección leídos del servidor.**
 * El cliente envía qué lección terminó y cuánto tardó; nunca cuánto XP merece.
 * Aceptar esa cifra convertiría la economía en un campo editable desde la
 * consola del navegador.
 *
 * Idempotente: repetir la llamada no vuelve a pagar. Sin esto, recargar la
 * página tras terminar una lección sería una máquina de XP infinito.
 */
export async function completeLesson(
  db: Database,
  input: {
    userId: string;
    lessonId: string;
    track: string;
    module: string;
    xpAwarded: number;
    seconds: number;
    flawless: boolean;
    usedHints: boolean;
  },
) {
  const existing = await loadProgress(db, input.userId, input.lessonId);
  const alreadyCompleted = existing?.status === 'completed';

  await db
    .insert(lessonProgress)
    .values({
      userId: input.userId,
      lessonId: input.lessonId,
      track: input.track,
      module: input.module,
      status: 'completed',
      xpEarned: input.xpAwarded,
      bestTimeMs: input.seconds * 1000,
    })
    .onConflictDoUpdate({
      target: [lessonProgress.userId, lessonProgress.lessonId],
      set: {
        status: 'completed',
        // El XP no se acumula al repetir: se queda el de la primera vez.
        xpEarned: alreadyCompleted ? existing!.xpEarned : input.xpAwarded,
        bestTimeMs: sql`LEAST(COALESCE(${lessonProgress.bestTimeMs}, 2147483647), ${input.seconds * 1000})`,
        updatedAt: new Date(),
      },
    });

  if (alreadyCompleted) {
    return { xpAwarded: 0, alreadyCompleted: true };
  }

  const [current] = await db.select().from(userStats).where(eq(userStats.userId, input.userId));
  const totalXp = (current?.totalXp ?? 0) + input.xpAwarded;

  await db
    .update(userStats)
    .set({
      totalXp,
      level: levelFromXp(totalXp).level,
      flawlessStreak: input.flawless ? (current?.flawlessStreak ?? 0) + 1 : 0,
      noHintLessons: input.usedHints
        ? (current?.noHintLessons ?? 0)
        : (current?.noHintLessons ?? 0) + 1,
      fastestClearSeconds:
        current?.fastestClearSeconds === null || current?.fastestClearSeconds === undefined
          ? input.seconds
          : Math.min(current.fastestClearSeconds, input.seconds),
      updatedAt: new Date(),
    })
    .where(eq(userStats.userId, input.userId));

  return { xpAwarded: input.xpAwarded, alreadyCompleted: false };
}

/** Sincroniza contadores de tecleo. Solo sube, nunca baja. */
export async function syncCounters(
  db: Database,
  userId: string,
  input: { keystrokes: number; bestCombo: number },
) {
  await db
    .update(userStats)
    .set({
      // `GREATEST` protege contra clientes con datos obsoletos o manipulados a
      // la baja; contra los inflados no hay defensa posible sin instrumentar
      // el editor, y no compensa.
      totalKeystrokes: sql`GREATEST(${userStats.totalKeystrokes}, ${input.keystrokes})`,
      bestCombo: sql`GREATEST(${userStats.bestCombo}, ${input.bestCombo})`,
      updatedAt: new Date(),
    })
    .where(eq(userStats.userId, userId));
}

export async function unlockAchievements(db: Database, userId: string, ids: string[]) {
  if (ids.length === 0) return [];

  const inserted = await db
    .insert(userAchievements)
    .values(ids.map((achievementId) => ({ userId, achievementId })))
    .onConflictDoNothing()
    .returning({ id: userAchievements.achievementId });

  return inserted.map((row) => row.id);
}

/** Estadísticas en la forma que espera el evaluador de logros. */
export async function buildPlayerStats(
  db: Database,
  userId: string,
  moduleSizes: Record<string, number>,
): Promise<PlayerStats> {
  const [stats] = await db.select().from(userStats).where(eq(userStats.userId, userId));
  const rows = await db
    .select()
    .from(lessonProgress)
    .where(and(eq(lessonProgress.userId, userId), eq(lessonProgress.status, 'completed')));

  const completedByTrack = { frontend: 0, backend: 0, devops: 0 };
  const perModule: Record<string, number> = {};

  for (const row of rows) {
    if (row.track in completedByTrack) {
      completedByTrack[row.track as keyof typeof completedByTrack]++;
    }
    perModule[row.module] = (perModule[row.module] ?? 0) + 1;
  }

  // Un módulo está completo cuando su cuenta iguala al total de lecciones que
  // existen en él, dato que solo el servidor conoce.
  const completedModules = Object.entries(perModule)
    .filter(([name, count]) => moduleSizes[name] !== undefined && count >= moduleSizes[name])
    .map(([name]) => name);

  return {
    totalKeystrokes: stats?.totalKeystrokes ?? 0,
    bestCombo: stats?.bestCombo ?? 0,
    completedLessons: rows.map((row) => row.lessonId),
    completedByTrack,
    completedModules,
    flawlessStreak: stats?.flawlessStreak ?? 0,
    noHintLessons: stats?.noHintLessons ?? 0,
    interviewsByCategory: {},
    fastestClearSeconds: stats?.fastestClearSeconds ?? null,
  };
}

export async function getUnlockedIds(db: Database, userId: string) {
  const rows = await db
    .select({ id: userAchievements.achievementId })
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId));
  return rows.map((row) => row.id);
}

export async function getStats(db: Database, userId: string) {
  const [row] = await db.select().from(userStats).where(eq(userStats.userId, userId));
  return row ?? null;
}

/** Progreso de todas las lecciones, para el mapa de mundos. */
export async function getTrackProgress(db: Database, userId: string) {
  return db.select().from(lessonProgress).where(eq(lessonProgress.userId, userId));
}
