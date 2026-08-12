import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Achievement } from '@/lib/content/types';
import {
  breakCombo,
  hasExpired,
  initialCombo,
  isCheatPaste,
  isProductiveKey,
  registerHit,
  type ComboState,
} from '@/lib/game/combo';
import { emptyStats, findNewlyUnlocked, type PlayerStats } from '@/lib/game/achievements';
import { levelFromXp, type LevelInfo } from '@/lib/game/xp';
import { getSoundEngine } from '@/lib/audio/engine';
import type { SoundPack } from '@/lib/audio/packs';

/**
 * Estado de juego: combo, XP, nivel, energía, logros y audio.
 *
 * Absorbe al antiguo `useSessionStore` (Fase 1), que existía para demostrar que
 * el progreso sobrevive al cambio de idioma. La razón de ser sigue vigente y es
 * más importante ahora: **nada de esto puede vivir en `useState`**, porque el
 * subárbol de `[locale]` se remonta al cambiar de idioma (ADR-01).
 */

/** Energía: se pierde con el daño y se recupera con el tiempo. */
const MAX_ENERGY = 100;
const DAMAGE_COST = 12;
const REGEN_PER_MINUTE = 20;

interface GameState {
  /* progreso */
  totalXp: number;
  level: LevelInfo;
  energy: number;
  lastEnergyTickAt: number;

  /* tecleo */
  keystrokes: number;
  combo: ComboState;

  /* logros */
  stats: PlayerStats;
  unlocked: string[];
  /** Cola de logros pendientes de celebrar. */
  pending: Achievement[];

  /* ajustes */
  performanceMode: boolean;
  soundPack: SoundPack;
  volume: number;

  registerKeystroke: (key: string, options?: { repeat?: boolean }) => void;
  registerPaste: (text: string) => void;
  refreshCombo: () => void;
  takeDamage: () => void;
  awardXp: (amount: number) => void;
  completeLesson: (input: {
    lessonId: string;
    track: 'frontend' | 'backend' | 'devops';
    xp: number;
    flawless: boolean;
    usedHints: boolean;
    seconds: number;
    interviewCategory?: string;
  }) => void;
  checkAchievements: (catalog: Achievement[]) => void;
  /** Cierra la lección contra el servidor, que decide el XP. */
  finishLesson: (input: {
    lessonId: string;
    seconds: number;
    usedHints: boolean;
    hintPenalty: number;
    flawless: boolean;
  }) => Promise<{ xpAwarded: number; alreadyCompleted: boolean } | null>;
  dismissAchievement: (id: string) => void;

  setPerformanceMode: (enabled: boolean) => void;
  setSoundPack: (pack: SoundPack) => void;
  setVolume: (volume: number) => void;
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      totalXp: 0,
      level: levelFromXp(0),
      energy: MAX_ENERGY,
      lastEnergyTickAt: Date.now(),

      keystrokes: 0,
      combo: initialCombo,

      stats: emptyStats,
      unlocked: [],
      pending: [],

      performanceMode: false,
      soundPack: 'silent',
      volume: 0.8,

      registerKeystroke: (key, options = {}) => {
        if (!isProductiveKey(key, options)) return;

        const state = get();
        const combo = registerHit(state.combo, Date.now());

        const engine = getSoundEngine();
        engine.intensity = Math.min((combo.multiplier - 1) / 2, 1);
        engine.playKey(key);

        // El sonido de "combo" solo al cruzar un escalón, no en cada tecla.
        if (combo.multiplier > state.combo.multiplier) engine.play('combo');

        set({
          keystrokes: state.keystrokes + 1,
          combo,
          stats: {
            ...state.stats,
            totalKeystrokes: state.stats.totalKeystrokes + 1,
            bestCombo: Math.max(state.stats.bestCombo, combo.count),
          },
        });
      },

      /**
       * Anti-cheat (ADR-06): un pegado grande rompe el combo.
       *
       * Sin esto, pegar la solución daría el multiplicador máximo y
       * «Racha imparable» dejaría de significar nada.
       */
      registerPaste: (text) => {
        if (!isCheatPaste(text)) return;
        set((state) => ({ combo: breakCombo(state.combo) }));
      },

      /** La UI llama a esto con un intervalo para reflejar el decay. */
      refreshCombo: () => {
        const state = get();
        const now = Date.now();

        if (hasExpired(state.combo, now)) {
          set({ combo: breakCombo(state.combo) });
        }

        // Regeneración de energía proporcional al tiempo transcurrido.
        const minutes = (now - state.lastEnergyTickAt) / 60_000;
        if (minutes > 0.25 && state.energy < MAX_ENERGY) {
          set({
            energy: Math.min(state.energy + minutes * REGEN_PER_MINUTE, MAX_ENERGY),
            lastEnergyTickAt: now,
          });
        } else if (minutes > 0.25) {
          set({ lastEnergyTickAt: now });
        }
      },

      takeDamage: () => {
        getSoundEngine().play('damage');
        set((state) => ({
          energy: Math.max(state.energy - DAMAGE_COST, 0),
          combo: breakCombo(state.combo),
        }));
      },

      awardXp: (amount) => {
        const state = get();
        const totalXp = state.totalXp + Math.max(amount, 0);
        const level = levelFromXp(totalXp);

        if (level.level > state.level.level) getSoundEngine().play('levelUp');

        set({ totalXp, level });
      },

      completeLesson: (input) => {
        const state = get();
        const already = state.stats.completedLessons.includes(input.lessonId);

        const stats: PlayerStats = {
          ...state.stats,
          completedLessons: already
            ? state.stats.completedLessons
            : [...state.stats.completedLessons, input.lessonId],
          completedByTrack: already
            ? state.stats.completedByTrack
            : {
                ...state.stats.completedByTrack,
                [input.track]: state.stats.completedByTrack[input.track] + 1,
              },
          flawlessStreak: input.flawless ? state.stats.flawlessStreak + 1 : 0,
          noHintLessons: input.usedHints
            ? state.stats.noHintLessons
            : state.stats.noHintLessons + 1,
          fastestClearSeconds:
            state.stats.fastestClearSeconds === null
              ? input.seconds
              : Math.min(state.stats.fastestClearSeconds, input.seconds),
          interviewsByCategory: input.interviewCategory
            ? {
                ...state.stats.interviewsByCategory,
                [input.interviewCategory]:
                  (state.stats.interviewsByCategory[input.interviewCategory] ?? 0) + 1,
              }
            : state.stats.interviewsByCategory,
        };

        set({ stats });
        get().awardXp(input.xp);
      },

      checkAchievements: (catalog) => {
        const state = get();
        const newly = findNewlyUnlocked(catalog, state.stats, state.unlocked);
        if (newly.length === 0) return;

        getSoundEngine().play('achievement');

        set({
          unlocked: [...state.unlocked, ...newly.map((achievement) => achievement.id)],
          pending: [...state.pending, ...newly],
        });

        for (const achievement of newly) get().awardXp(achievement.xpReward);
      },

      /**
       * ⚠️ No envía cuánto XP merece: envía qué hizo. El servidor lee las
       * recompensas de la lección y calcula la cifra. Aceptarla del cliente
       * convertiría el nivel en un campo editable desde devtools.
       */
      finishLesson: async (input) => {
        try {
          const response = await fetch('/api/progress/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...input, comboMultiplier: get().combo.multiplier }),
          });
          if (!response.ok) return null;

          const data = (await response.json()) as {
            xpAwarded: number;
            alreadyCompleted: boolean;
            achievements: Achievement[];
          };

          // El XP mostrado es el que el servidor concedió, no una estimación local.
          if (data.xpAwarded > 0) get().awardXp(data.xpAwarded);
          if (data.achievements.length > 0) {
            getSoundEngine().play('achievement');
            set((state) => ({
              unlocked: [...state.unlocked, ...data.achievements.map((a) => a.id)],
              pending: [...state.pending, ...data.achievements],
            }));
          }

          return { xpAwarded: data.xpAwarded, alreadyCompleted: data.alreadyCompleted };
        } catch {
          return null;
        }
      },

      dismissAchievement: (id) =>
        set((state) => ({ pending: state.pending.filter((a) => a.id !== id) })),

      setPerformanceMode: (enabled) => {
        if (typeof document !== 'undefined') {
          document.documentElement.dataset.performanceMode = String(enabled);
        }
        // El modo rendimiento apaga también el audio: `prefers-reduced-motion`
        // no cubre el sonido, así que este es el único interruptor que lo hace.
        getSoundEngine().setMuted(enabled);
        set({ performanceMode: enabled });
      },

      setSoundPack: (pack) => {
        const engine = getSoundEngine();
        engine.setPack(pack);
        void engine.unlock().then(() => {
          // Muestra inmediata: elegir un pack sin oírlo es elegir a ciegas.
          if (pack !== 'silent') engine.play('key');
        });
        set({ soundPack: pack });
      },

      setVolume: (volume) => {
        getSoundEngine().setVolume(volume);
        set({ volume });
      },
    }),
    {
      name: 'codequest.game',
      partialize: (state) => ({
        totalXp: state.totalXp,
        keystrokes: state.keystrokes,
        stats: state.stats,
        unlocked: state.unlocked,
        performanceMode: state.performanceMode,
        soundPack: state.soundPack,
        volume: state.volume,
      }),
      // El nivel se deriva del XP: persistirlo permitiría que ambos
      // divergieran, y entonces habría dos verdades sobre lo mismo.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.level = levelFromXp(state.totalXp);
        state.combo = initialCombo;
        state.energy = MAX_ENERGY;
      },
    },
  ),
);
