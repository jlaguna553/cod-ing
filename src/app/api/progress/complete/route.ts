import { NextResponse } from 'next/server';
import { observarRuta } from '@/lib/observability/log';
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
import { verifyStatic } from '@/lib/engine/static';
import { log } from '@/lib/observability/log';

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
 *
 * ⚠️ **Y tampoco se fía de que la lección esté hecha.** Quedaba la otra mitad:
 * el servidor calculaba bien la cifra, pero se la daba a quien dijera «he
 * terminado». Ahora hay que mandar **el código**, y el servidor comprueba
 * contra él las reglas del último paso que puede juzgar sin ejecutar nada
 * (ADR-23). Reclamar el XP deja de ser una petición y pasa a ser mandar algo
 * que pase las comprobaciones — que es hacer el ejercicio.
 *
 * Lo que necesita ejecución —la salida por consola, el DOM, una consulta SQL—
 * no se puede verificar aquí y no se finge que sí: se cuenta aparte y la
 * respuesta lo dice en `verified`.
 */

const CompleteSchema = z.object({
  lessonId: z.string().min(1),
  seconds: z.number().int().nonnegative().max(86_400),
  usedHints: z.boolean(),
  hintPenalty: z.number().int().nonnegative().max(1000),
  flawless: z.boolean(),
  /** Multiplicador alcanzado. Se recorta al techo que fija la propia lección. */
  comboMultiplier: z.number().min(1).max(5),
  /**
   * El código con el que se terminó.
   *
   * Viaja en la petición y no se lee del autoguardado a propósito: el
   * autoguardado tiene 2,5 s de retardo, así que al terminar el último paso
   * la base todavía guarda la versión anterior. Verificar contra ella
   * suspendería a quien acaba de resolverlo bien.
   */
  codeSnapshot: z.record(z.string(), z.string()).default({}),
});

/** Tope del envío. Un workspace de lección no llega ni de lejos. */
const MAX_CODIGO = 64 * 1024;

async function manejarPost(request: Request) {
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

  const codigo = parsed.data.codeSnapshot;
  const tamano = Object.values(codigo).reduce((suma, texto) => suma + texto.length, 0);
  if (tamano > MAX_CODIGO) {
    return NextResponse.json({ error: 'code-too-large' }, { status: 413 });
  }

  /*
   * Se verifica el ÚLTIMO paso, que es el que se acaba de superar.
   *
   * Con un ejercicio por paso (ADR-12), el archivo final ya no cumple —ni
   * debe— las reglas de los anteriores: el paso 3 pide otra cosa que el 1.
   * Exigirlas todas suspendería a quien ha hecho la lección entera.
   */
  const ultimoPaso = lesson.steps.at(-1);
  const reglasDelPaso = (ultimoPaso?.ruleIds ?? [])
    .map((id) => lesson.rules.find((rule) => rule.id === id))
    .filter((rule): rule is NonNullable<typeof rule> => Boolean(rule));

  const verificacion = verifyStatic(reglasDelPaso as never, codigo);

  if (verificacion.fallidas.length > 0) {
    log.warn('complete.rejected', {
      lesson: lesson.id,
      userId,
      failed: verificacion.fallidas.join(','),
    });
    return NextResponse.json(
      { error: 'not-verified', failed: verificacion.fallidas },
      { status: 422 },
    );
  }

  /*
   * Sin nada que comprobar se concede igual, y se registra.
   *
   * Nueve de las treinta y cinco lecciones terminan en un paso que solo se
   * puede juzgar ejecutando —salida por consola, DOM, SQL—. Negarles el XP
   * castigaría al usuario por una limitación nuestra; concederlo en silencio
   * escondería cuánto de la economía sigue sin verificar. Queda en el log y en
   * la respuesta.
   */
  const verified = verificacion.comprobadas > 0;

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

  log.info('complete', {
    lesson: lesson.id,
    xp: result.xpAwarded,
    verified,
    comprobadas: verificacion.comprobadas,
    sinVerificar: verificacion.fueraDeAlcance,
  });

  return NextResponse.json({
    xpAwarded: result.xpAwarded,
    alreadyCompleted: result.alreadyCompleted,
    achievements: newly.filter((achievement) => granted.includes(achievement.id)),
    /** `false` = la lección terminaba en algo que solo se juzga ejecutando. */
    verified,
  });
}

/*
 * Cada ruta sale con su duración y su código en el log.
 * Registrar solo los fallos deja «esto va lento» en una impresión: sin la
 * línea del caso bueno no hay con qué comparar.
 */
export const POST = (request: Request) =>
  observarRuta('progress/complete:POST', () => manejarPost(request));
