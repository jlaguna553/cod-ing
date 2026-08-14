'use client';

import { useTranslations } from 'next-intl';
import { CheckCircle2, Target } from 'lucide-react';
import { useCurrentStep, useLessonStore } from '@/stores/useLessonStore';
import { useEvaluationStore } from '@/stores/useEvaluationStore';
import { HintCard } from './HintCard';

/**
 * Qué hay que hacer. Ancla fija del panel: nunca se va con el scroll.
 *
 * Antes la instrucción vivía dentro del cuerpo de la guía, después de varios
 * párrafos de explicación. Funcionaba para quien leía en orden, pero quien
 * volvía a la lección o bajaba al panel de pruebas ya no la encontraba: la
 * pregunta «¿y ahora qué tengo que hacer?» no debería exigir releer — ni
 * siquiera desplazarse.
 *
 * Lleva también el progreso por pasos, que estaba en la guía y se perdía al
 * bajar: saber cuánto queda es información de cabecera, no de cuerpo.
 *
 * Y las pistas, que vivían al final de la guía. Pedir ayuda obligaba a dejar de
 * mirar el enunciado y bajar a buscarlas — justo cuando estás atascado. Ahora
 * se abren donde ya estás mirando.
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

      {/* Progreso por pasos: segmentos, no barra continua — se lee de un vistazo. */}
      <div className="mb-3 flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={
              'h-1 flex-1 rounded-full ' +
              (i < stepIndex
                ? 'bg-[var(--color-success)]'
                : i === stepIndex
                  ? 'bg-[var(--color-neon)]'
                  : 'bg-[var(--color-border)]')
            }
          />
        ))}
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

      <HintCard />
    </section>
  );
}
