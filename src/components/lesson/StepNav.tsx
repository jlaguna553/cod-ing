'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCurrentStep, useLessonStore } from '@/stores/useLessonStore';
import { useEvaluationStore } from '@/stores/useEvaluationStore';

/**
 * Navegación entre pasos, fuera del cuerpo de la guía.
 *
 * Vivía al final del texto explicativo, así que en un paso largo había que
 * bajar hasta el fondo para encontrar «Siguiente». Sacarla a la zona fija del
 * panel la deja siempre a un clic: el texto se lee con scroll, los controles
 * no se mueven.
 */
export function StepNav() {
  const t = useTranslations();
  const step = useCurrentStep();
  const stepIndex = useLessonStore((s) => s.stepIndex);
  const total = useLessonStore((s) => s.lesson?.steps.length ?? 0);
  const nextStep = useLessonStore((s) => s.nextStep);
  const previousStep = useLessonStore((s) => s.previousStep);
  const evaluate = useEvaluationStore((s) => s.evaluate);

  if (!step) return null;

  const isLastStep = stepIndex === total - 1;

  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={previousStep}
        disabled={stepIndex === 0}
        className="flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-border-glow)] hover:text-[var(--color-ink)] disabled:pointer-events-none disabled:opacity-30"
      >
        <ChevronLeft size={13} />
        {t('steps.previous')}
      </button>

      <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">+{step.xp} XP</span>

      {/*
        En el último paso el botón deja de decir «Siguiente»: no hay siguiente.
        Antes quedaba deshabilitado sin explicación y la lección no tenía
        salida visible.
      */}
      <button
        type="button"
        onClick={isLastStep ? () => evaluate() : nextStep}
        className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-[var(--color-void)] transition-opacity hover:opacity-90"
        style={{ backgroundColor: isLastStep ? 'var(--color-success)' : 'var(--color-neon)' }}
      >
        {isLastStep ? t('steps.finish') : t('steps.next')}
        <ChevronRight size={13} />
      </button>
    </div>
  );
}
