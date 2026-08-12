import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import {
  buildPlayerStats,
  ensureUser,
  getStats,
  getUnlockedIds,
  loadProgress,
  saveProgress,
  syncCounters,
  touchStreak,
} from '@/lib/db/queries';
import { getOrCreateUserId } from '@/lib/auth/session';
import { getAchievements, getLesson, getModuleSizes } from '@/lib/content/loader';
import { findNewlyUnlocked } from '@/lib/game/achievements';
import { unlockAchievements } from '@/lib/db/queries';

/**
 * Autosave y carga de progreso.
 *
 * `GET`  → estado del jugador y, si se pide `lesson`, su avance en ella.
 * `POST` → guarda el avance. El cliente llama con debounce.
 *
 * Ninguna de las dos acepta XP del cliente: eso vive en `/api/progress/complete`
 * y lo calcula el servidor.
 */

const SaveSchema = z.object({
  lessonId: z.string().min(1),
  stepIndex: z.number().int().nonnegative(),
  hintsUsed: z.number().int().nonnegative(),
  damageTaken: z.number().int().nonnegative(),
  codeSnapshot: z.record(z.string(), z.string()),
  keystrokes: z.number().int().nonnegative(),
  bestCombo: z.number().int().nonnegative(),
});

export async function GET(request: Request) {
  const { id: userId } = await getOrCreateUserId();
  const db = await getDb();
  await ensureUser(db, userId);

  const lessonId = new URL(request.url).searchParams.get('lesson');
  const [stats, unlocked, streak] = await Promise.all([
    getStats(db, userId),
    getUnlockedIds(db, userId),
    touchStreak(db, userId),
  ]);

  const progress = lessonId ? await loadProgress(db, userId, lessonId) : null;

  return NextResponse.json({
    userId,
    stats: stats ?? null,
    unlocked,
    streakDays: streak.streakDays,
    progress,
  });
}

export async function POST(request: Request) {
  const { id: userId } = await getOrCreateUserId();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid-body', issues: parsed.error.issues.map((i) => i.path.join('.')) },
      { status: 400 },
    );
  }

  // El track y el módulo salen del contenido, no del cliente: son datos del
  // servidor y aceptarlos de fuera permitiría falsear las estadísticas por track.
  const lesson = getLesson(parsed.data.lessonId);
  if (!lesson) {
    return NextResponse.json({ error: 'unknown-lesson' }, { status: 404 });
  }

  const db = await getDb();
  await ensureUser(db, userId);

  await saveProgress(db, {
    userId,
    lessonId: lesson.id,
    track: lesson.track,
    module: lesson.module,
    stepIndex: parsed.data.stepIndex,
    hintsUsed: parsed.data.hintsUsed,
    damageTaken: parsed.data.damageTaken,
    codeSnapshot: parsed.data.codeSnapshot,
  });

  await syncCounters(db, userId, {
    keystrokes: parsed.data.keystrokes,
    bestCombo: parsed.data.bestCombo,
  });

  // Los logros se conceden aquí, con estadísticas leídas de la base de datos.
  const stats = await buildPlayerStats(db, userId, getModuleSizes());
  const unlocked = await getUnlockedIds(db, userId);
  const newly = findNewlyUnlocked(getAchievements(), stats, unlocked);
  const granted = await unlockAchievements(db, userId, newly.map((a) => a.id));

  return NextResponse.json({
    ok: true,
    unlocked: granted,
    achievements: newly.filter((achievement) => granted.includes(achievement.id)),
  });
}
