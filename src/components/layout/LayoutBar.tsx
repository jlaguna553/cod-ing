'use client';

import { useTranslations } from 'next-intl';
import { ArrowLeft, Eye, LayoutGrid, RotateCcw } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useLayoutStore, WIDGETS } from '@/stores/useLayoutStore';
import { ThemePicker } from './ThemePicker';
import { useAvailableWidgets, useWidgetLabels } from './widgets';

/**
 * Barra superior de la pantalla de juego.
 *
 * Trae dos cosas que faltaban:
 *
 * 1. **La salida.** Se podía entrar en una lección y no había forma de volver
 *    al mapa sin el botón atrás del navegador o editando la URL. Una pantalla
 *    sin salida visible es un callejón, por bonita que sea.
 * 2. **El modo personalizar**, con las tarjetas ocultas a un clic de volver.
 *    Ocultar algo sin una forma evidente de recuperarlo es una trampa.
 */
export function LayoutBar({ track }: { track: string }) {
  const t = useTranslations();
  const labels = useWidgetLabels();
  const widgets = useLayoutStore((s) => s.widgets);
  const editing = useLayoutStore((s) => s.editing);
  const toggleEditing = useLayoutStore((s) => s.toggleEditing);
  const setVisible = useLayoutStore((s) => s.setVisible);
  const reset = useLayoutStore((s) => s.reset);

  const disponibles = useAvailableWidgets();
  const hidden = WIDGETS.filter((id) => !widgets[id].visible && disponibles.has(id));

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2">
      <Link
        href={`/tracks/${track}`}
        className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-border-glow)] hover:text-[var(--color-ink)]"
      >
        <ArrowLeft size={13} />
        {t('nav.backToTrack')}
      </Link>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <ThemePicker />

        {editing && hidden.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
              {t('layout.hiddenTray')}
            </span>
            {hidden.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setVisible(id, true)}
                className="flex items-center gap-1 rounded-md border border-dashed border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-neon)] hover:text-[var(--color-ink)]"
              >
                <Eye size={11} />
                {labels[id]}
              </button>
            ))}
          </div>
        )}

        {editing && (
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-damage)] hover:text-[var(--color-ink)]"
          >
            <RotateCcw size={12} />
            {t('layout.reset')}
          </button>
        )}

        <button
          type="button"
          onClick={toggleEditing}
          aria-pressed={editing}
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors"
          style={{
            borderColor: editing ? 'var(--color-neon)' : 'var(--color-border)',
            color: editing ? 'var(--color-neon)' : 'var(--color-ink-dim)',
          }}
        >
          <LayoutGrid size={13} />
          {editing ? t('layout.done') : t('layout.customize')}
        </button>
      </div>
    </header>
  );
}
