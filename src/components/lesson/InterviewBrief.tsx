'use client';

import { useTranslations } from 'next-intl';
import { Briefcase, ChevronDown } from 'lucide-react';
import { useLessonStore } from '@/stores/useLessonStore';
import { Panel } from '@/components/layout/GameShell';
import { Markdown } from './Markdown';

/**
 * Briefing de lección tipo entrevista.
 *
 * Las preguntas de seguimiento van colapsadas y se abren por iniciativa del
 * usuario: en una entrevista real llegan DESPUÉS de resolver, y leerlas antes
 * regala la mitad del razonamiento. `<details>` nativo — accesible sin JS.
 */
export function InterviewBrief() {
  const t = useTranslations();
  const interview = useLessonStore((s) => s.lesson?.interview ?? null);

  if (!interview) return null;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2 text-[var(--color-neon-alt)]">
          <Briefcase size={13} />
          {t('interview.brief')}
        </span>
      }
      action={
        <span className="rounded border border-[var(--color-neon-alt)]/40 px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--color-neon-alt)]">
          {interview.company_style}
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <Markdown>{interview.prompt}</Markdown>

        {interview.constraints.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-ink-faint)]">
              {t('interview.constraints')}
            </p>
            <ul className="space-y-1">
              {interview.constraints.map((constraint, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-[12px] leading-relaxed text-[var(--color-ink-dim)]"
                >
                  <span className="text-[var(--color-neon-alt)]">▸</span>
                  {constraint}
                </li>
              ))}
            </ul>
          </div>
        )}

        {interview.complexity && (
          <p className="font-mono text-[11px] text-[var(--color-ink-faint)]">
            {t('interview.complexity')}: {interview.complexity.time ?? '—'} /{' '}
            {interview.complexity.space ?? '—'}
          </p>
        )}

        {interview.followUps.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-ink-faint)]">
              {t('interview.followUps')}
            </p>
            <div className="space-y-1.5">
              {interview.followUps.map((followUp, i) => (
                <details
                  key={i}
                  className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-abyss)] px-3 py-2"
                >
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-2 text-[12px] text-[var(--color-ink)]">
                    {followUp.question}
                    <ChevronDown
                      size={13}
                      className="mt-0.5 shrink-0 text-[var(--color-ink-faint)] transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <div className="mt-2 border-t border-[var(--color-border)] pt-2">
                    <Markdown>{followUp.answer}</Markdown>
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
