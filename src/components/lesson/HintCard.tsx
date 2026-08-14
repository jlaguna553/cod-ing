'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, Lightbulb, Loader2, Lock } from 'lucide-react';
import type { Locale } from '@/lib/content/types';
import { useCurrentStep, useLessonStore } from '@/stores/useLessonStore';
import { Markdown } from './Markdown';

/**
 * Pistas escalonadas por `tier`: primero la conceptual, al final el código.
 *
 * Vive **dentro del reto**, no en un panel aparte.
 *
 * Estaba al final de la guía, así que para pedir una pista había que dejar de
 * mirar el enunciado y bajar a buscarla — justo cuando estás atascado, que es
 * cuando menos ganas hay de navegar. Ahora se abre donde ya estás mirando: la
 * pregunta «¿y ahora qué hago?» y su ayuda comparten sitio.
 *
 * Dos decisiones pedagógicas se conservan intactas:
 *  - el coste en XP se muestra ANTES de revelar, para que sea una decisión;
 *  - una pista de tier N se bloquea hasta haber usado las anteriores, así
 *    nadie salta directo a la solución sin haber intentado pensar.
 *
 * Y una tercera que nace de moverlas: **arrancan plegadas**. Al estar pegadas
 * al enunciado, tenerlas siempre desplegadas convertiría en ruido permanente
 * algo que solo interesa cuando te has atascado.
 */
export function HintCard() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const step = useCurrentStep();
  const revealedHints = useLessonStore((s) => s.revealedHints);
  const hintTexts = useLessonStore((s) => s.hintTexts);
  const revealHint = useLessonStore((s) => s.revealHint);
  const [open, setOpen] = useState(false);

  const hints = [...(step?.hints ?? [])].sort((a, b) => a.tier - b.tier);

  // Un paso sin pistas no anuncia que no las tiene: no ocupa nada.
  if (hints.length === 0) return null;

  const usedCount = hints.filter((hint) => revealedHints.includes(hint.id)).length;
  // Si ya gastaste una, se queda abierto: esconder lo que has pagado es cruel.
  const expanded = open || usedCount > 0;

  return (
    <div className="mt-3 border-t border-[var(--color-border)] pt-2.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-power)]"
      >
        <span className="flex items-center gap-1.5">
          <Lightbulb size={11} />
          {t('panels.hints')}
        </span>
        <span className="flex items-center gap-1.5 font-mono normal-case tracking-normal">
          {t('hints.revealed', { used: usedCount, total: hints.length })}
          {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </span>
      </button>

      {expanded && (
        /* Tope de altura con scroll propio: el reto es zona fija, y una pista
           larga no puede empujar las pruebas fuera de la pantalla. */
        <div className="mt-2 flex max-h-[26vh] flex-col gap-2 overflow-y-auto">
          {hints.map((hint, index) => {
            const isRevealed = revealedHints.includes(hint.id);
            const isLocked = index > 0 && !revealedHints.includes(hints[index - 1].id);

            if (isRevealed) {
              // El texto llega del servidor: hay un instante de carga real.
              const text = hintTexts[hint.id];
              return (
                <div
                  key={hint.id}
                  className="rounded-lg border border-[var(--color-power)]/30 bg-[var(--color-power)]/5 p-2.5"
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
                className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2 text-left transition-colors hover:border-[var(--color-power)]/50 disabled:pointer-events-none disabled:opacity-40"
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
      )}
    </div>
  );
}
