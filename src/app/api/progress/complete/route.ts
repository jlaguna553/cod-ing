import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import {
  buildPlayerStats,
  completeLesson,
  ensureUser,
  getUnlockedIds,
  unlockAchievements,
} from '@/lib/db/queries';
import { getOrCreateUserId } from '@/lib/auth/session';
import { getAchievements, getLesson, getModuleSizes } from '@/lib/content/loader';
import { findNewlyUnlocked } from '@/lib/game/achievements';
import { lessonXp } from '@/lib/game/xp';

/**
 * Completar una lección y cobrar el XP.
 *
 * ⚠️ **El cliente no envía cuánto XP merece.** Envía qué lección terminó, cuánto
 * tardó, si usó pistas y si recibió daño. El servidor lee las recompensas de la
 * lección desde `content/`, aplica la fórmula y decide la cifra.
 *
 * Era el hueco declarado al cerrar la Fase 6: hasta ahora la economía vivía
 * entera en el cliente y bastaba la consola del navegador para inventarse el
 * nivel 99.
 */

const CompleteSchema = z.object({
  lessonId: z.string().min(1),
  seconds: z.number().int().nonnegative().max(86_400),
  usedHints: z.boolean(),
  hintPenalty: z.number().int().nonnegative().max(1000),
  flawless: z.boolean(),
  /** Multiplicador alcanzado. Se recorta al techo que fija la propia lección. */
  comboMultiplier: z.number().min(1).max(5),
});

export async function POST(request: Request) {
  const { id: userId } = await getOrCreateUserId();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  const parsed = CompleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid-body' }, { status: 400 });
  }

  const lesson = getLesson(parsed.data.lessonId);
  if (!lesson) {
    return NextResponse.json({ error: 'unknown-lesson' }, { status: 404 });
  }

  // Fuente de verdad de las recompensas: el contenido, no la petición.
  const xpAwarded = lessonXp({
    baseXp: lesson.reward.baseXp,
    flawlessBonus: lesson.reward.flawlessBonus,
    noHintBonus: lesson.reward.noHintBonus,
    comboMultiplier: parsed.data.comboMultiplier,
    comboMultiplierCap: lesson.reward.comboMultiplierCap,
    flawless: parsed.data.flawless,
    usedHints: parsed.data.usedHints,
    hintPenalty: parsed.data.hintPenalty,
  });

  const db = await getDb();
  await ensureUser(db, userId);

  const result = await completeLesson(db, {
    userId,
    lessonId: lesson.id,
    track: lesson.track,
    module: lesson.module,
    xpAwarded,
    seconds: parsed.data.seconds,
    flawless: parsed.data.flawless,
    usedHints: parsed.data.usedHints,
  });

  const stats = await buildPlayerStats(db, userId, getModuleSizes());
  const unlocked = await getUnlockedIds(db, userId);
  const newly = findNewlyUnlocked(getAchievements(), stats, unlocked);
  const granted = await unlockAchievements(db, userId, newly.map((a) => a.id));

  return NextResponse.json({
    xpAwarded: result.xpAwarded,
    alreadyCompleted: result.alreadyCompleted,
    achievements: newly.filter((achievement) => granted.includes(achievement.id)),
  });
}
