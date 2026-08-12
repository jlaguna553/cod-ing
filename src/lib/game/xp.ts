/**
 * Curva de progresión.
 *
 * Crecimiento cuadrático suave: cada nivel cuesta un poco más que el anterior,
 * pero sin el muro exponencial que hace que a partir del nivel 20 nada se
 * sienta como progreso. Con los XP que reparten las lecciones actuales
 * (100-420 por lección), esto da un nivel cada 2-3 lecciones al principio y
 * cada 5-6 hacia el nivel 20 — que es el ritmo que mantiene la sensación de
 * avance sin trivializarla.
 */
const BASE = 250;
const CURVE = 1.45;

/** XP total acumulado necesario para alcanzar `level`. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  let total = 0;
  for (let step = 1; step < level; step++) {
    total += Math.round(BASE * Math.pow(step, CURVE) / step);
  }
  return total;
}

export interface LevelInfo {
  level: number;
  /** XP dentro del nivel actual. */
  current: number;
  /** XP que exige el nivel actual para completarse. */
  needed: number;
  /** 0..1, para la barra. */
  progress: number;
}

export function levelFromXp(totalXp: number): LevelInfo {
  let level = 1;
  while (xpForLevel(level + 1) <= totalXp && level < 999) level++;

  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  const current = totalXp - floor;
  const needed = ceiling - floor;

  return {
    level,
    current,
    needed,
    progress: needed === 0 ? 1 : Math.min(current / needed, 1),
  };
}

/**
 * XP de una lección terminada.
 *
 * Las bonificaciones son aditivas y el combo multiplica solo la base: si
 * multiplicara también los bonus, una racha de tecleo valdría más que resolver
 * sin pistas, y la mecánica premiaría teclear rápido por encima de pensar.
 */
export function lessonXp(options: {
  baseXp: number;
  flawlessBonus: number;
  noHintBonus: number;
  comboMultiplier: number;
  comboMultiplierCap: number;
  flawless: boolean;
  usedHints: boolean;
  hintPenalty: number;
}): number {
  const multiplier = Math.min(Math.max(options.comboMultiplier, 1), options.comboMultiplierCap);

  let total = Math.round(options.baseXp * multiplier);
  if (options.flawless) total += options.flawlessBonus;
  if (!options.usedHints) total += options.noHintBonus;

  return Math.max(total - options.hintPenalty, 0);
}
