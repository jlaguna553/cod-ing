'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, EyeOff, GripVertical } from 'lucide-react';
import { useLayoutStore, widgetsOf, type WidgetId, type Zone } from '@/stores/useLayoutStore';
import { Widget, useAvailableWidgets, useWidgetLabels } from './widgets';

/**
 * Una zona de la pantalla, compuesta con las tarjetas que el usuario ha puesto
 * en ella.
 *
 * Fuera del modo edición esto es transparente: pinta las tarjetas visibles en
 * su orden y nada más. Dentro, cada una gana un asa para arrastrar, botones
 * para subir y bajar, y uno para ocultarla.
 *
 * **Arrastrar y los botones hacen lo mismo, a propósito.** El arrastre es lo
 * que la gente espera; los botones son la única vía con teclado, y además
 * funcionan en móvil, donde arrastrar entre columnas es un gesto incómodo. Que
 * la funcionalidad dependa de un solo gesto es lo que deja fuera a quien no
 * puede hacerlo.
 */
export function WidgetZone({
  zone,
  className = '',
}: {
  zone: Zone;
  className?: string;
}) {
  const t = useTranslations();
  const labels = useWidgetLabels();
  const widgets = useLayoutStore((s) => s.widgets);
  const editing = useLayoutStore((s) => s.editing);
  const moveWidget = useLayoutStore((s) => s.moveWidget);
  const nudge = useLayoutStore((s) => s.nudge);
  const setVisible = useLayoutStore((s) => s.setVisible);

  const disponibles = useAvailableWidgets();
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const ids = widgetsOf(widgets, zone).filter((id) => disponibles.has(id));

  /*
   * Se usa el arrastre nativo del navegador. Con `dataTransfer` se puede soltar
   * en OTRA columna sin que las zonas tengan que hablar entre ellas: quien
   * recibe lee el id del que viene y se lo pide al store.
   */
  const onDrop = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/codequest-widget') as WidgetId;
    setDropIndex(null);
    if (id) moveWidget(id, zone, index);
  };

  const allowDrop = (event: React.DragEvent, index: number) => {
    if (!event.dataTransfer.types.includes('text/codequest-widget')) return;
    event.preventDefault();
    setDropIndex(index);
  };

  if (!editing) {
    return (
      <div className={className} data-zone={zone}>
        {ids.map((id) => (
          <Widget key={id} id={id} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={className}
      data-zone={zone}
      onDragOver={(event) => allowDrop(event, ids.length)}
      onDrop={(event) => onDrop(event, ids.length)}
    >
      {ids.map((id, index) => (
        <div
          key={id}
          data-widget={id}
          onDragOver={(event) => {
            event.stopPropagation();
            allowDrop(event, index);
          }}
          onDrop={(event) => {
            event.stopPropagation();
            onDrop(event, index);
          }}
          className={
            'rounded-[var(--radius-panel)] outline-dashed outline-1 outline-offset-2 ' +
            (dropIndex === index
              ? 'outline-[var(--color-neon)]'
              : 'outline-[var(--color-border-glow)]')
          }
        >
          <div className="mb-1 flex items-center gap-1 px-1">
            <span
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('text/codequest-widget', id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => setDropIndex(null)}
              aria-label={t('layout.drag', { widget: labels[id] })}
              className="cursor-grab text-[var(--color-ink-faint)] hover:text-[var(--color-neon)] active:cursor-grabbing"
            >
              <GripVertical size={13} />
            </span>

            <span className="mr-auto truncate text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
              {labels[id]}
            </span>

            <ZoneButton
              label={t('layout.up', { widget: labels[id] })}
              disabled={index === 0}
              onClick={() => nudge(id, -1)}
            >
              <ChevronUp size={12} />
            </ZoneButton>
            <ZoneButton
              label={t('layout.down', { widget: labels[id] })}
              disabled={index === ids.length - 1}
              onClick={() => nudge(id, 1)}
            >
              <ChevronDown size={12} />
            </ZoneButton>
            <ZoneButton
              label={t('layout.hide', { widget: labels[id] })}
              onClick={() => setVisible(id, false)}
            >
              <EyeOff size={12} />
            </ZoneButton>
          </div>

          {/* La tarjeta sigue viva mientras se ordena: se ve lo que se mueve. */}
          <Widget id={id} />
        </div>
      ))}

      {ids.length === 0 && (
        <p className="rounded-[var(--radius-panel)] border border-dashed border-[var(--color-border)] p-4 text-center text-[11px] text-[var(--color-ink-faint)]">
          {t('layout.emptyZone')}
        </p>
      )}
    </div>
  );
}

function ZoneButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-0.5 text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)] disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
