'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, Play, Target } from 'lucide-react';
import { useCurrentStep, useLessonStore } from '@/stores/useLessonStore';
import { useEvaluationStore } from '@/stores/useEvaluationStore';
import { useRunnerStore } from '@/stores/useRunnerStore';
import { runAndEvaluate } from '@/lib/game/attempt';
import { HintCard } from './HintCard';
import { TestChecks, useTestScore } from './TestResultList';

/**
 * El reto: enunciado, pruebas y controles en **una sola tarjeta**.
 *
 * Eran tres —«reto», «pruebas» y «anterior/siguiente»— y las tres hablaban del
 * mismo paso. Repartidas, cada una traía su marco y su título, y la relación
 * entre ellas había que reconstruirla mirando: lo que se pide, en qué se falla
 * y cómo se sigue son un solo asunto y ahora se leen de arriba abajo sin salir
 * de un recuadro.
 *
 * **No se avanza sin resolver.** Antes «Siguiente» estaba disponible desde el
 * primer segundo, así que el paso se podía saltar sin escribir una línea — y
 * quien lo hacía llegaba al final sin haber practicado nada, que es justo lo
 * contrario de para lo que existe el editor. Ahora hay un único botón que
 * empieza siendo «Evaluar» y **se convierte** en «Siguiente», con otro color,
 * cuando las comprobaciones pasan. El mismo sitio, el mismo dedo: el estado del
 * paso se lee en el botón que se iba a pulsar de todos modos.
 */
export function ChallengeCard() {
  const t = useTranslations();
  const step = useCurrentStep();
  const stepIndex = useLessonStore((s) => s.stepIndex);
  const total = useLessonStore((s) => s.lesson?.steps.length ?? 0);
  const nextStep = useLessonStore((s) => s.nextStep);
  const previousStep = useLessonStore((s) => s.previousStep);

  const stepPassed = useEvaluationStore((s) => s.stepPassed);
  const runnerStatus = useRunnerStore((s) => s.status);
  const { passed, total: totalChecks } = useTestScore();

  const [evaluando, setEvaluando] = useState(false);

  if (!step) return null;

  const accent = stepPassed ? 'var(--color-success)' : 'var(--color-neon)';
  const isLastStep = stepIndex === total - 1;
  /*
   * Deshabilitado mientras el runner trabaja, igual que «Ejecutar».
   *
   * Las reglas que miran el DOM leen un espejo del documento que solo existe
   * cuando la ejecución termina. Evaluar antes las deja en gris —«pendiente»—
   * sobre un código que en realidad está bien, y el usuario no tiene forma de
   * saber que solo le faltaba esperar.
   */
  const ocupado = evaluando || runnerStatus === 'booting' || runnerStatus === 'running';

  const evaluar = async () => {
    setEvaluando(true);
    try {
      await runAndEvaluate();
    } finally {
      setEvaluando(false);
    }
  };

  return (
    <section
      className="flex min-h-0 flex-1 flex-col rounded-[var(--radius-panel)] border-2 bg-[var(--color-panel)]"
      style={{ borderColor: accent, boxShadow: `0 0 32px -14px ${accent}` }}
      aria-labelledby="task-heading"
    >
      {/* ── El reto ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 p-4 pb-3">
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

        <HintCard />
      </div>

      {/* ── Las pruebas ─────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--color-border)] px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-ink-faint)]">
            {t('panels.tests')}
          </h3>
          {totalChecks > 0 && (
            <span
              className="font-mono text-[10px]"
              style={{ color: stepPassed ? 'var(--color-success)' : 'var(--color-ink-faint)' }}
            >
              {passed}/{totalChecks}
            </span>
          )}
        </div>
        <TestChecks />
      </div>

      {/* ── Los controles ───────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--color-border)] p-3">
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
          Un botón, dos vidas. Superado el paso cambia de nombre, de color y de
          lo que hace; y en el último no hay «siguiente» que ofrecer, así que
          dice que se ha terminado y deja hablar a la tarjeta de cierre, que
          aparece justo debajo con el XP y el enlace a la lección siguiente.
        */}
        {!stepPassed ? (
          <button
            type="button"
            onClick={() => void evaluar()}
            disabled={ocupado}
            className="flex items-center gap-1.5 rounded-md bg-[var(--color-neon)] px-3 py-1.5 text-xs font-semibold text-[var(--color-void)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {ocupado ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Play size={13} className="rotate-90" />
            )}
            {t('steps.evaluate')}
          </button>
        ) : isLastStep ? (
          <span className="flex items-center gap-1.5 rounded-md bg-[var(--color-success)] px-3 py-1.5 text-xs font-semibold text-[var(--color-void)]">
            <CheckCircle2 size={13} />
            {t('steps.finish')}
          </span>
        ) : (
          <button
            type="button"
            onClick={nextStep}
            className="flex items-center gap-1.5 rounded-md bg-[var(--color-success)] px-3 py-1.5 text-xs font-semibold text-[var(--color-void)] transition-opacity hover:opacity-90"
          >
            {t('steps.next')}
            <ChevronRight size={13} />
          </button>
        )}
      </div>
    </section>
  );
}
