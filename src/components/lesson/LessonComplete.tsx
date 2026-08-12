'use client';

import { useTranslations } from 'next-intl';
import { ArrowRight, Map, Trophy } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useLessonStore } from '@/stores/useLessonStore';
import { useGameStore } from '@/stores/useGameStore';

/**
 * Cierre de la lección.
 *
 * Existe porque faltaba la salida: al superar el último paso no había ninguna
 * señal de haber terminado ni forma de continuar. El usuario se quedaba
 * mirando un panel sin comprobaciones sin saber qué hacer — y la siguiente
 * lección seguía bloqueada en el mapa.
 *
 * El XP que muestra es el que **concedió el servidor**, no una estimación
 * local: si la lección ya estaba completada, la cifra es 0 y se dice.
 */
export function LessonComplete({
  nextLessonId,
  track,
}: {
  nextLessonId: string | null;
  track: string;
}) {
  const t = useTranslations();
  const completion = useLessonStore((s) => s.completion);

  const level = useGameStore((s) => s.level);

  if (!completion) return null;

  return (
    <section
      className="rounded-[var(--radius-panel)] border-2 border-[var(--color-success)] bg-[var(--color-success)]/5 p-4"
      style={{ boxShadow: '0 0 40px -16px var(--color-success)' }}
      aria-labelledby="lesson-complete-heading"
    >
      <h2
        id="lesson-complete-heading"
        className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-success)]"
      >
        <Trophy size={13} />
        {t('lesson.completed')}
      </h2>

      <p className="mt-2 font-mono text-2xl text-[var(--color-success)] text-glow">
        {completion.alreadyCompleted ? t('lesson.alreadyDone') : `+${completion.xpAwarded} XP`}
      </p>
      <p className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">
        {t('hud.level', { level: level.level })} · {t('hud.xp', {
          current: level.current,
          next: level.needed,
        })}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {nextLessonId ? (
          <Link
            href={`/play/${track}/${nextLessonId}`}
            className="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-success)] px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--color-void)]"
          >
            {t('lesson.next')}
            <ArrowRight size={14} />
          </Link>
        ) : (
          <p className="text-[12px] leading-relaxed text-[var(--color-ink-dim)]">
            {t('lesson.lastOfModule')}
          </p>
        )}

        <Link
          href={`/tracks/${track}`}
          className="flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-border-glow)] hover:text-[var(--color-ink)]"
        >
          <Map size={13} />
          {t('lesson.backToMap')}
        </Link>
      </div>
    </section>
  );
}
