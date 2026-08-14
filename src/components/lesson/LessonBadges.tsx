'use client';

import { useTranslations } from 'next-intl';
import { useLessonStore } from '@/stores/useLessonStore';

/** Título de la lección con su tipo, nivel y duración. */
export function LessonBadges() {
  const t = useTranslations();
  const lesson = useLessonStore((s) => s.lesson);

  if (!lesson) return null;

  return (
    <div className="rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <p className="text-sm font-semibold leading-tight text-[var(--color-ink)]">{lesson.title}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge>{t(`lessonKind.${lesson.kind}`)}</Badge>
        <Badge>{t(`difficulty.${lesson.difficulty}`)}</Badge>
        <Badge>{lesson.estimatedMinutes} min</Badge>
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-[var(--color-border)] bg-[var(--color-abyss)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--color-ink-faint)]">
      {children}
    </span>
  );
}
