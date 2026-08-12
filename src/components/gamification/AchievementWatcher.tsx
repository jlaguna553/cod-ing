'use client';

import { useEffect } from 'react';
import type { Achievement } from '@/lib/content/types';
import { useGameStore } from '@/stores/useGameStore';

/**
 * Comprueba los logros cuando cambian las estadísticas del jugador.
 *
 * Vive fuera del árbol de evaluación a propósito: el catálogo llega del
 * servidor ya validado y el chequeo debe ocurrir pase lo que pase (terminar
 * un paso, subir el combo, acumular pulsaciones), no solo al pulsar un botón.
 *
 * Hoy la concesión ocurre en cliente y por tanto es falseable. La Fase 7 la
 * moverá al servidor: `isUnlocked` ya es una función pura sobre `PlayerStats`
 * precisamente para poder reutilizarla allí sin cambios.
 */
export function AchievementWatcher({ catalog }: { catalog: Achievement[] }) {
  const stats = useGameStore((s) => s.stats);
  const checkAchievements = useGameStore((s) => s.checkAchievements);

  useEffect(() => {
    checkAchievements(catalog);
  }, [stats, catalog, checkAchievements]);

  return null;
}
