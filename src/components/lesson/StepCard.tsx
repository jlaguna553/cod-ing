'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCurrentStep, useLessonStore } from '@/stores/useLessonStore';
import { useEvaluationStore } from '@/stores/useEvaluationStore';
import { useGameStore } from '@/stores/useGameStore';
import { Panel } from '@/components/layout/GameShell';
import { Markdown } from './Markdown';

export function StepCard() {
  const t = useTranslations();
  const step = useCurrentStep();
  const stepIndex = useLessonStore((s) => s.stepIndex);
  const total = useLessonStore((s) => s.lesson?.steps.length ?? 0);
  const nextStep = useLessonStore((s) => s.nextStep);
  const previousStep = useLessonStore((s) => s.previousStep);

  const lessonId = useLessonStore((s) => s.lesson?.id ?? null);
  const revealedHints = useLessonStore((s) => s.revealedHints);
  const stepPassed = useEvaluationStore((s) => s.stepPassed);
  const evaluate = useEvaluationStore((s) => s.evaluate);
  const finishLesson = useGameStore((s) => s.finishLesson);

  const setCompletion = useLessonStore((state) => state.setCompletion);
  const [finished, setFinished] = useState(false);
  const startedAt = useRef(Date.now());
  const damageSeen = useRef(false);

  useEffect(() => {
    startedAt.current = Date.now();
    damageSeen.current = false;
    setFinished(false);
  }, [lessonId]);

  // Cualquier daño recibido durante la lección invalida el bonus "sin fallos".
  const results = useEvaluationStore((s) => s.results);
  useEffect(() => {
    if (Object.values(results).some((r) => !r.passed && r.severity === 'damage')) {
      damageSeen.current = true;
    }
  }, [results]);

  /**
   * Cierre de la lección: ocurre al superar el ÚLTIMO paso.
   *
   * El XP no se calcula aquí — se pide al servidor, que lee las recompensas de
   * la lección y decide. El guardia `finished` evita cobrar dos veces si el
   * usuario vuelve a pulsar «Validar».
   */
  const isLastStep = stepIndex === total - 1;
  useEffect(() => {
    if (!stepPassed || !isLastStep || finished || !lessonId) return;
    setFinished(true);

    void finishLesson({
      lessonId,
      seconds: Math.round((Date.now() - startedAt.current) / 1000),
      usedHints: revealedHints.length > 0,
      hintPenalty: 0,
      flawless: !damageSeen.current,
    }).then((result) => {
      // El panel de cierre se dispara con la respuesta del servidor: sin ella
      // no habría forma de saber si la lección concedió XP o ya estaba hecha.
      if (result) setCompletion(result);
    });
  }, [stepPassed, isLastStep, finished, lessonId, revealedHints.length, finishLesson, setCompletion]);

  if (!step) {
    return (
      <Panel title={t('panels.guide')}>
        <p className="text-xs text-[var(--color-ink-faint)]">{t('empty.noLesson')}</p>
      </Panel>
    );
  }

  return (
    <Panel
      title={t('panels.guide')}
      action={
        <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">
          {t('steps.counter', { current: stepIndex + 1, total })}
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Progreso por pasos: segmentos, no barra continua — se lee de un vistazo. */}
        <div className="flex gap-1">
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

        <h3 className="text-sm font-semibold text-[var(--color-ink)]">{step.title}</h3>

        <Markdown>{step.body}</Markdown>

        {step.bestPractice && (
          <div className="rounded-lg border border-[var(--color-power)]/30 bg-[var(--color-power)]/5 p-3">
            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-power)]">
              <ShieldCheck size={11} />
              {t('steps.bestPractice')}
            </p>
            <Markdown>{step.bestPractice}</Markdown>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={previousStep}
            disabled={stepIndex === 0}
            className="flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-border-glow)] hover:text-[var(--color-ink)] disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronLeft size={13} />
            {t('steps.previous')}
          </button>
          <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">
            +{step.xp} XP
          </span>
          {/*
            En el último paso el botón deja de decir «Siguiente»: no hay
            siguiente. Antes quedaba deshabilitado sin explicación y la lección
            no tenía salida visible.
          */}
          <button
            type="button"
            onClick={isLastStep ? () => evaluate() : nextStep}
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold text-[var(--color-void)] transition-opacity hover:opacity-90"
            style={{
              backgroundColor: isLastStep ? 'var(--color-success)' : 'var(--color-neon)',
            }}
          >
            {isLastStep ? t('steps.finish') : t('steps.next')}
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </Panel>
  );
}
