'use client';

import { useTranslations } from 'next-intl';
import { CheckCircle2, Target } from 'lucide-react';
import { useCurrentStep, useLessonStore } from '@/stores/useLessonStore';
import { useEvaluationStore } from '@/stores/useEvaluationStore';

/**
 * Qué hay que hacer, en su propia sección y arriba del todo.
 *
 * Antes la instrucción vivía dentro del cuerpo de la guía, después de varios
 * párrafos de explicación. Funcionaba para quien leía en orden, pero quien
 * volvía a la lección o bajaba al panel de pruebas ya no la encontraba: la
 * pregunta «¿y ahora qué tengo que hacer?» no debería exigir releer.
 *
 * Va antes que la explicación a propósito. El objetivo primero, el porqué
 * después: quien ya lo sabe no tiene que buscarlo.
 */
export function TaskCard() {
  const t = useTranslations();
  const step = useCurrentStep();
  const stepIndex = useLessonStore((s) => s.stepIndex);
  const total = useLessonStore((s) => s.lesson?.steps.length ?? 0);
  const stepPassed = useEvaluationStore((s) => s.stepPassed);

  if (!step) return null;

  const accent = stepPassed ? 'var(--color-success)' : 'var(--color-neon)';

  return (
    <section
      className="rounded-[var(--radius-panel)] border-2 bg-[var(--color-panel)] p-4"
      style={{
        borderColor: accent,
        boxShadow: `0 0 32px -14px ${accent}`,
      }}
      aria-labelledby="task-heading"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2
          id="task-heading"
          className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ color: accent }}
        >
          {stepPassed ? <CheckCircle2 size={13} /> : <Target size={13} />}
          {t('steps.task')}
        </h2>
        <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">
          {t('steps.counter', { current: stepIndex + 1, total })}
        </span>
      </div>

      {/* Tamaño mayor que el resto del panel: es la frase que más se relee. */}
      <p className="text-[15px] font-medium leading-relaxed text-[var(--color-ink)]">
        {step.task}
      </p>

      {step.focusFile && (
        <p className="mt-2 font-mono text-[10px] text-[var(--color-ink-faint)]">
          {t('steps.editFile', { file: step.focusFile })}
        </p>
      )}

      {stepPassed && (
        <p className="mt-2 text-[11px] font-semibold" style={{ color: accent }}>
          {t('steps.done')}
        </p>
      )}
    </section>
  );
}
