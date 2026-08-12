'use client';

import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/lib/content/types';
import { t as pick } from '@/lib/content/localize';
import { useGameStore } from '@/stores/useGameStore';

const TIER_COLOR: Record<string, string> = {
  bronze: '#c88a4a',
  silver: '#b8c4d6',
  gold: 'var(--color-power)',
  legendary: 'var(--color-neon-alt)',
};

/**
 * Celebración de logros.
 *
 * Se apilan y se cierran solos a los 6 s. El confeti se carga con `import()`
 * en el momento de usarlo: es una librería que solo hace falta en un instante
 * puntual, y no debe pesar en la carga inicial de cada lección.
 */
export function AchievementToast() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const pending = useGameStore((s) => s.pending);
  const dismiss = useGameStore((s) => s.dismissAchievement);
  const performanceMode = useGameStore((s) => s.performanceMode);

  useEffect(() => {
    if (pending.length === 0) return;

    if (!performanceMode && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      void import('canvas-confetti').then(({ default: confetti }) => {
        void confetti({
          particleCount: 70,
          spread: 62,
          origin: { y: 0.75 },
          colors: ['#22d3ee', '#c084fc', '#fbbf24', '#4ade80'],
          disableForReducedMotion: true,
        });
      });
    }

    const timers = pending.map((achievement) =>
      window.setTimeout(() => dismiss(achievement.id), 6000),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [pending, dismiss, performanceMode]);

  if (pending.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
      {pending.map((achievement) => {
        const color = TIER_COLOR[achievement.tier] ?? 'var(--color-neon)';
        return (
          <button
            key={achievement.id}
            type="button"
            onClick={() => dismiss(achievement.id)}
            className="pointer-events-auto flex items-center gap-3 rounded-[var(--radius-panel)] border bg-[var(--color-panel)] px-4 py-3 text-left shadow-lg"
            style={{ borderColor: color, boxShadow: `0 0 28px -10px ${color}` }}
          >
            <span className="text-2xl" aria-hidden>
              {achievement.icon}
            </span>
            <div className="min-w-0">
              <p
                className="text-[10px] font-semibold uppercase tracking-widest"
                style={{ color }}
              >
                {t('achievements.unlocked')}
              </p>
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                {pick(achievement.title, locale)}
              </p>
              <p className="text-[11px] leading-snug text-[var(--color-ink-dim)]">
                {pick(achievement.description, locale)}
              </p>
            </div>
            <span className="ml-2 shrink-0 font-mono text-xs" style={{ color }}>
              +{achievement.xpReward}
            </span>
          </button>
        );
      })}
    </div>
  );
}
