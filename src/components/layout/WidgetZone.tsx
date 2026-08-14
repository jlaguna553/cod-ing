'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, EyeOff, GripVertical, Maximize2 } from 'lucide-react';
import { useLayoutStore, widgetsOf, type WidgetId, type Zone } from '@/stores/useLayoutStore';
import { Splitter } from './Splitter';
import { Widget, useAvailableWidgets, useWidgetLabels } from './widgets';

/**
 * Una zona de la pantalla, compuesta con las tarjetas que el usuario ha puesto
 * en ella.
 *
 * Fuera del modo edición pinta las tarjetas visibles en su orden, cada una con
 * un asa para ajustar su alto. Dentro, cada una gana además un asa para
 * arrastrar, botones para subir y bajar, y uno para ocultarla.
 *
 * **Arrastrar y los botones hacen lo mismo, a propósito.** El arrastre es lo
 * que la gente espera; los botones son la única vía con teclado, y además
 * funcionan en móvil, donde arrastrar entre columnas es un gesto incómodo. Que
 * la funcionalidad dependa de un solo gesto es lo que deja fuera a quien no
 * puede hacerlo.
 *
 * **Soltar encima de otra las intercambia.** No inserta empujando la lista: el
 * usuario apunta a un hueco concreto y espera ocuparlo, no desplazar a todas
 * las de abajo — que con columnas de distinta longitud descoloca más de lo que
 * coloca.
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
  const heights = useLayoutStore((s) => s.heights);
  const editing = useLayoutStore((s) => s.editing);
  const moveWidget = useLayoutStore((s) => s.moveWidget);
  const swap = useLayoutStore((s) => s.swap);
  const nudge = useLayoutStore((s) => s.nudge);
  const setVisible = useLayoutStore((s) => s.setVisible);
  const setHeight = useLayoutStore((s) => s.setHeight);

  const disponibles = useAvailableWidgets();
  const [sobre, setSobre] = useState<WidgetId | null>(null);
  const ids = widgetsOf(widgets, zone).filter((id) => disponibles.has(id));

  const MIME = 'text/codequest-widget';

  const permitirSoltar = (event: React.DragEvent, destino: WidgetId | null) => {
    if (!event.dataTransfer.types.includes(MIME)) return;
    event.preventDefault();
    setSobre(destino);
  };

  const soltar = (event: React.DragEvent, destino: WidgetId | null) => {
    event.preventDefault();
    const origen = event.dataTransfer.getData(MIME) as WidgetId;
    setSobre(null);
    if (!origen) return;

    // Encima de una tarjeta: se cambian de sitio. En el hueco: al final.
    if (destino) swap(origen, destino);
    else moveWidget(origen, zone, ids.length);
  };

  return (
    <div
      className={className}
      data-zone={zone}
      onDragOver={(event) => permitirSoltar(event, null)}
      onDrop={(event) => soltar(event, null)}
    >
      {ids.map((id, index) => {
        const alto = heights[id];

        return (
          <div
            key={id}
            data-widget={id}
            /*
             * `shrink-0` es obligatorio, no estética.
             *
             * En una columna flex los hijos se comprimen por defecto. Sin esto,
             * el contenedor bajaba por debajo del alto de la tarjeta y esta se
             * salía y se dibujaba **encima de la siguiente**. Era el solape que
             * se veía al reordenar.
             */
            className={
              'flex shrink-0 flex-col ' +
              (alto ? 'overflow-hidden ' : '') +
              (sobre === id ? 'rounded-[var(--radius-panel)] outline outline-2 outline-[var(--color-neon)]' : '')
            }
            style={alto ? { height: alto } : undefined}
            onDragOver={(event) => {
              event.stopPropagation();
              permitirSoltar(event, id);
            }}
            onDrop={(event) => {
              event.stopPropagation();
              soltar(event, id);
            }}
          >
            {editing && (
              <div className="mb-1 flex items-center gap-1 px-1">
                <span
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(MIME, id);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setSobre(null)}
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
                  label={t('layout.autoHeight', { widget: labels[id] })}
                  disabled={alto === undefined}
                  onClick={() => setHeight(id, null)}
                >
                  <Maximize2 size={12} />
                </ZoneButton>
                <ZoneButton
                  label={t('layout.hide', { widget: labels[id] })}
                  onClick={() => setVisible(id, false)}
                >
                  <EyeOff size={12} />
                </ZoneButton>
              </div>
            )}

            {/* La tarjeta sigue viva mientras se ordena: se ve lo que se mueve. */}
            <div className={alto ? 'min-h-0 flex-1 overflow-y-auto' : ''}>
              <Widget id={id} />
            </div>

            {/*
              Asa de alto, siempre disponible: redimensionar es un ajuste de
              ventana, no una función escondida en un modo. La primera vez fija
              el alto actual y a partir de ahí lo mueve.
            */}
            <CardResizer id={id} label={labels[id]} />
          </div>
        );
      })}

      {ids.length === 0 && editing && (
        <p className="rounded-[var(--radius-panel)] border border-dashed border-[var(--color-border)] p-4 text-center text-[11px] text-[var(--color-ink-faint)]">
          {t('layout.emptyZone')}
        </p>
      )}
    </div>
  );
}

/** Divisor bajo una tarjeta que ajusta su alto en píxeles. */
function CardResizer({ id, label }: { id: WidgetId; label: string }) {
  const t = useTranslations();
  const heights = useLayoutStore((s) => s.heights);
  const setHeight = useLayoutStore((s) => s.setHeight);

  /*
   * Sin alto fijado se parte del que la tarjeta tiene AHORA, medido del DOM.
   *
   * Con un valor inventado, el primer paso daba un salto: una tarjeta de 489 px
   * se encogía de golpe a 256 porque el cálculo partía de 240. Se mide por el
   * atributo `data-widget` en vez de arrastrar una `ref` por todo el árbol —
   * es el mismo elemento que ya identifica a la tarjeta para los tests.
   */
  const aplicar = (delta: number) => {
    const actual =
      heights[id] ??
      document.querySelector(`[data-widget="${id}"]`)?.getBoundingClientRect().height ??
      200;
    setHeight(id, actual + delta);
  };

  return (
    <Splitter
      orientation="horizontal"
      label={t('layout.resizeCard', { widget: label })}
      onDelta={aplicar}
      onKeyStep={aplicar}
    />
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
