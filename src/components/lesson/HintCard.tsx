'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Lightbulb, Loader2, Lock } from 'lucide-react';
import type { Locale } from '@/lib/content/types';
import { useCurrentStep, useLessonStore } from '@/stores/useLessonStore';
import { Panel } from '@/components/layout/GameShell';
import { Markdown } from './Markdown';

/**
 * Pistas escalonadas por `tier`: primero la conceptual, al final el código.
 *
 * Dos decisiones pedagógicas visibles en la UI:
 *  - el coste en XP se muestra ANTES de revelar, para que sea una decisión;
 *  - una pista de tier N se bloquea hasta haber usado las anteriores, así
 *    nadie salta directo a la solución sin haber intentado pensar.
 */
export function HintCard() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const step = useCurrentStep();
  const revealedHints = useLessonStore((s) => s.revealedHints);
  const hintTexts = useLessonStore((s) => s.hintTexts);
  const revealHint = useLessonStore((s) => s.revealHint);

  const hints = [...(step?.hints ?? [])].sort((a, b) => a.tier - b.tier);

  if (hints.length === 0) {
    return (
      <Panel title={t('panels.hints')}>
        <p className="text-xs text-[var(--color-ink-faint)]">{t('hints.none')}</p>
      </Panel>
    );
  }

  const usedCount = hints.filter((h) => revealedHints.includes(h.id)).length;

  return (
    <Panel
      title={t('panels.hints')}
      action={
        <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">
          {t('hints.revealed', { used: usedCount, total: hints.length })}
        </span>
      }
    >
      <div className="flex flex-col gap-2">
        {hints.map((hint, i) => {
          const isRevealed = revealedHints.includes(hint.id);
          const isLocked = i > 0 && !revealedHints.includes(hints[i - 1].id);

          if (isRevealed) {
            // El texto llega del servidor: hay un instante de carga real.
            const text = hintTexts[hint.id];
            return (
              <div
                key={hint.id}
                className="rounded-lg border border-[var(--color-power)]/30 bg-[var(--color-power)]/5 p-3"
              >
                <p className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[var(--color-power)]">
                  <Lightbulb size={11} />
                  {hint.tier === 3 ? '★★★' : hint.tier === 2 ? '★★' : '★'}
                </p>
                {text ? (
                  <Markdown>{text}</Markdown>
                ) : (
                  <Loader2 size={13} className="animate-spin text-[var(--color-power)]" />
                )}
              </div>
            );
          }

          return (
            <button
              key={hint.id}
              type="button"
              disabled={isLocked}
              onClick={() => void revealHint(hint.id, locale)}
              className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2.5 text-left transition-colors hover:border-[var(--color-power)]/50 disabled:pointer-events-none disabled:opacity-40"
            >
              <span className="flex items-center gap-2 text-xs text-[var(--color-ink-dim)]">
                {isLocked ? <Lock size={12} /> : <Lightbulb size={12} />}
                {t('hints.reveal')}
              </span>
              <span className="font-mono text-[10px] text-[var(--color-damage)]">
                −{hint.xpPenalty} XP
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
