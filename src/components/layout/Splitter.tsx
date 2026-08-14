'use client';

import { useCallback, useRef } from 'react';

/**
 * Divisor arrastrable entre dos regiones.
 *
 * Con eventos de puntero, no con los de ratón: el mismo código sirve para dedo,
 * lápiz y ratón, y `setPointerCapture` mantiene el arrastre aunque el cursor se
 * salga del divisor — sin eso, mover rápido lo suelta a medio camino.
 *
 * Es además un `separator` de verdad para la accesibilidad: se enfoca con Tab y
 * se mueve con las flechas, porque redimensionar con el teclado tiene que ser
 * posible aunque casi nadie lo use.
 */
export function Splitter({
  orientation,
  onDelta,
  onKeyStep,
  label,
}: {
  orientation: 'vertical' | 'horizontal';
  /** Píxeles movidos desde el último evento. Se pasa el evento para poder medir. */
  onDelta: (delta: number, event: React.PointerEvent<HTMLDivElement>) => void;
  /** Paso al usar las flechas del teclado. */
  onKeyStep: (delta: number) => void;
  label: string;
}) {
  const last = useRef<number | null>(null);
  const vertical = orientation === 'vertical';

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    last.current = vertical ? event.clientX : event.clientY;
  }, [vertical]);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (last.current === null) return;
      const position = vertical ? event.clientX : event.clientY;
      onDelta(position - last.current, event);
      last.current = position;
    },
    [onDelta, vertical],
  );

  const stop = useCallback(() => {
    last.current = null;
  }, []);

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={(event) => {
        const paso = event.shiftKey ? 48 : 16;
        if (event.key === (vertical ? 'ArrowLeft' : 'ArrowUp')) onKeyStep(-paso);
        else if (event.key === (vertical ? 'ArrowRight' : 'ArrowDown')) onKeyStep(paso);
        else return;
        event.preventDefault();
      }}
      className={
        'group relative shrink-0 touch-none transition-colors ' +
        'hover:bg-[var(--color-neon)]/30 focus-visible:bg-[var(--color-neon)]/50 ' +
        (vertical ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize')
      }
    >
      {/* El asa visible es fina; el área que responde al puntero, no tanto. */}
      <span
        className={
          'absolute rounded-full bg-[var(--color-border)] group-hover:bg-[var(--color-neon)] ' +
          (vertical ? 'inset-y-0 left-1/2 w-px -translate-x-1/2' : 'inset-x-0 top-1/2 h-px -translate-y-1/2')
        }
      />
    </div>
  );
}
