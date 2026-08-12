import type { Achievement, Track } from '@/lib/content/types';

/**
 * Estadísticas contra las que se evalúan los disparadores.
 *
 * Es deliberadamente un objeto plano y no el store: así el evaluador se puede
 * probar en Node y —cuando llegue la Fase 7— reutilizar tal cual en el
 * servidor, donde los logros se validarán de verdad. Hoy se conceden en
 * cliente y por tanto son falseables; el diseño ya está listo para moverlo.
 */
export interface PlayerStats {
  totalKeystrokes: number;
  bestCombo: number;
  /** Ids de lecciones completadas. */
  completedLessons: string[];
  /** Lecciones completadas por track. */
  completedByTrack: Record<Track, number>;
  /** Módulos con todas sus lecciones completadas. */
  completedModules: string[];
  /** Lecciones seguidas sin recibir daño. */
  flawlessStreak: number;
  /** Lecciones resueltas sin gastar pistas. */
  noHintLessons: number;
  /** Retos de entrevista superados, por categoría. */
  interviewsByCategory: Record<string, number>;
  /** Mejor tiempo de resolución, en segundos. */
  fastestClearSeconds: number | null;
}

export const emptyStats: PlayerStats = {
  totalKeystrokes: 0,
  bestCombo: 0,
  completedLessons: [],
  completedByTrack: { frontend: 0, backend: 0, devops: 0 },
  completedModules: [],
  flawlessStreak: 0,
  noHintLessons: 0,
  interviewsByCategory: {},
  fastestClearSeconds: null,
};

/** ¿Se cumple la condición de este logro? */
export function isUnlocked(achievement: Achievement, stats: PlayerStats): boolean {
  const trigger = achievement.trigger;

  switch (trigger.type) {
    case 'combo-reached':
      return stats.bestCombo >= trigger.value;

    case 'keystrokes-total':
      return stats.totalKeystrokes >= trigger.value;

    case 'lessons-completed':
      return trigger.track
        ? stats.completedByTrack[trigger.track] >= trigger.value
        : stats.completedLessons.length >= trigger.value;

    case 'module-completed':
      return stats.completedModules.includes(trigger.module);

    case 'flawless-streak':
      return stats.flawlessStreak >= trigger.value;

    case 'no-hint-lessons':
      return stats.noHintLessons >= trigger.value;

    case 'interview-solved':
      return (stats.interviewsByCategory[trigger.category] ?? 0) >= trigger.value;

    case 'speed-clear':
      return stats.fastestClearSeconds !== null && stats.fastestClearSeconds <= trigger.underSeconds;

    default:
      return false;
  }
}

/**
 * Logros recién desbloqueados.
 *
 * Devuelve solo los que **cambian** de estado, no todos los que se cumplen:
 * al reabrir la app no debe dispararse una cascada de toasts por logros que ya
 * se celebraron hace semanas.
 */
export function findNewlyUnlocked(
  catalog: Achievement[],
  stats: PlayerStats,
  alreadyUnlocked: string[],
): Achievement[] {
  const known = new Set(alreadyUnlocked);
  return catalog.filter(
    (achievement) => !known.has(achievement.id) && isUnlocked(achievement, stats),
  );
}

/**
 * Progreso hacia un logro, 0..1.
 *
 * Los que no son acumulativos (un módulo completo, una entrevista concreta)
 * solo tienen 0 o 1: fingir un progreso continuo sería mentir sobre lo que
 * falta.
 */
export function progressToward(achievement: Achievement, stats: PlayerStats): number {
  const trigger = achievement.trigger;
  const ratio = (value: number, target: number) => Math.min(value / target, 1);

  switch (trigger.type) {
    case 'combo-reached':
      return ratio(stats.bestCombo, trigger.value);
    case 'keystrokes-total':
      return ratio(stats.totalKeystrokes, trigger.value);
    case 'lessons-completed':
      return ratio(
        trigger.track ? stats.completedByTrack[trigger.track] : stats.completedLessons.length,
        trigger.value,
      );
    case 'flawless-streak':
      return ratio(stats.flawlessStreak, trigger.value);
    case 'no-hint-lessons':
      return ratio(stats.noHintLessons, trigger.value);
    case 'interview-solved':
      return ratio(stats.interviewsByCategory[trigger.category] ?? 0, trigger.value);
    default:
      return isUnlocked(achievement, stats) ? 1 : 0;
  }
}
