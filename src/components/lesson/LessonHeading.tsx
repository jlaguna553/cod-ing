'use client';

import { useTranslations } from 'next-intl';
import { useLessonStore } from '@/stores/useLessonStore';

/**
 * Título de la lección con su tipo, nivel y duración.
 *
 * Vive en la barra superior y no en una tarjeta. Era la única que no se podía
 * *usar* para nada: no se pulsa, no cambia y no se consulta a media partida —
 * dice dónde estás, que es exactamente el trabajo de una cabecera. Ocupando una
 * tarjeta movible robaba altura a las que sí se usan.
 */
export function LessonHeading() {
  const t = useTranslations();
  const lesson = useLessonStore((s) => s.lesson);

  if (!lesson) return null;

  return (
    <div className="flex min-w-0 items-center gap-2">
      {/* El título se recorta antes de empujar a los controles fuera de la barra. */}
      <span className="truncate text-sm font-semibold text-[var(--color-ink)]">{lesson.title}</span>
      <span className="hidden shrink-0 gap-1.5 sm:flex">
        <Badge>{t(`lessonKind.${lesson.kind}`)}</Badge>
        <Badge>{t(`difficulty.${lesson.difficulty}`)}</Badge>
        <Badge>{lesson.estimatedMinutes} min</Badge>
      </span>
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
