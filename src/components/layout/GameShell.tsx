'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useLayoutStore } from '@/stores/useLayoutStore';
import { useTranslations } from 'next-intl';
import { LayoutBar } from './LayoutBar';
import { Splitter } from './Splitter';
import { WidgetZone } from './WidgetZone';

/**
 * Layout de la pantalla de juego.
 *
 *   ┌─────────────────── barra: volver · personalizar ───────────────────┐
 *   ├──────────┬───────────────────────────┬──────────────────────────────┤
 *   │ zona     │   CodeCanvas (hero)       │ zona `guide`  (scroll)       │
 *   │ `left`   ├───────────────────────────┤                              │
 *   │          │   OutputDock              │ zona `dock`   (fija)         │
 *   └──────────┴───────────────────────────┴──────────────────────────────┘
 *
 * Las tres columnas se redimensionan y las tarjetas se mueven entre zonas, así
 * que este componente ya no sabe **qué** hay en cada sitio: solo reparte el
 * espacio y deja que `WidgetZone` componga con lo que el usuario haya decidido.
 *
 * Lo que no cambia es la mecánica de alturas: grid de 100dvh y `min-h-0` en las
 * celdas, que es lo que permite que Monaco y Xterm midan su propio alto y hagan
 * scroll interno en vez de empujar la página.
 *
 * Los anchos van en `style` y no en clases de Tailwind a propósito: son un
 * número que cambia en cada arrastre, y generar clases dinámicas no funciona
 * con un compilador que las extrae del código fuente.
 */
/**
 * Lo que se le reserva al editor pase lo que pase, en píxeles.
 *
 * Es la columna entera: el panel se queda unos 40 en bordes y relleno, así que
 * por debajo de esto el código empieza a llegar cortado a media línea.
 */
const MIN_CENTRO = 420;

export function GameShell({
  editor,
  output,
  complete,
  track,
}: {
  editor: ReactNode;
  output: ReactNode;
  /** Cierre de lección: solo existe al terminar, y manda sobre el resto. */
  complete: ReactNode;
  track: string;
}) {
  const t = useTranslations();
  const columns = useLayoutStore((s) => s.columns);
  const editorRatio = useLayoutStore((s) => s.editorRatio);
  const dockHeight = useLayoutStore((s) => s.dockHeight);
  const setColumn = useLayoutStore((s) => s.setColumn);
  const setEditorRatio = useLayoutStore((s) => s.setEditorRatio);
  const setDockHeight = useLayoutStore((s) => s.setDockHeight);

  // Empieza en 0 —y con factor 1— para que el primer render del cliente sea
  // idéntico al del servidor; el efecto lo ajusta antes de que se note.
  const [anchoVentana, setAnchoVentana] = useState(0);
  useEffect(() => {
    const medir = () => setAnchoVentana(window.innerWidth);
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, []);

  /*
   * Arrastrar hacia arriba agranda la franja, así que el delta se resta. Y sin
   * alto fijado se parte del que tiene ahora, medido del DOM: con un valor por
   * defecto, el primer paso la encogía de golpe en vez de moverla.
   */
  /*
   * Las columnas ceden en proporción antes que aplastar el editor.
   *
   * El ancho guardado está en píxeles, y el mismo reparto que en una pantalla
   * ancha se ve bien deja al centro en 230 px en una tablet: la barra del
   * editor se salía y el código llegaba recortado. Se reduce lo que haga falta
   * para que el centro conserve un mínimo, **manteniendo la proporción** entre
   * las dos columnas — que es lo que el usuario eligió.
   *
   * En una pantalla que da de sí, el factor es 1 y no se toca nada: recortar
   * por `max-width` habría sido más corto, pero entonces arrastrar el divisor
   * dejaba de hacer nada al llegar al tope, sin decir por qué.
   */
  const factor = anchoVentana > 0
    ? Math.min(1, Math.max(0.3, (anchoVentana - MIN_CENTRO) / (columns.left + columns.right)))
    : 1;
  const anchoIzquierda = Math.round(columns.left * factor);
  const anchoDerecha = Math.round(columns.right * factor);

  const ajustarFranja = (delta: number) => {
    const actual =
      dockHeight ??
      document.querySelector('[data-zone="dock"]')?.parentElement?.getBoundingClientRect().height ??
      240;
    setDockHeight(actual - delta);
  };

  return (
    <div className="flex h-dvh flex-col gap-3 p-3">
      <LayoutBar track={track} />

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-0">
        <aside
          className="hidden min-h-0 flex-col gap-3 lg:flex"
          style={{ width: anchoIzquierda, flex: '0 0 auto' }}
        >
          <WidgetZone zone="left" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" />
        </aside>

        <div className="hidden self-stretch lg:block">
          <Splitter
            orientation="vertical"
            label={t('layout.resizeLeft')}
            onDelta={(delta) => setColumn('left', columns.left + delta)}
            onKeyStep={(delta) => setColumn('left', columns.left + delta)}
          />
        </div>

        {/*
          `min-w-0` es lo que permite que las columnas laterales crezcan.

          Un elemento flex tiene `min-width: auto`, es decir: no encoge por
          debajo del ancho mínimo de su contenido. Y aquí el contenido es
          Monaco, que pide mucho. Sin esto, ensanchar la columna derecha
          aumentaba su ancho de verdad —el store subía de 400 a 550— pero el
          centro se negaba a ceder y la columna se salía por el borde: hacia la
          derecha se veía encoger, hacia la izquierda no pasaba nada.
        */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <section className="min-h-0" style={{ flex: `${editorRatio} 1 0%` }}>
            {editor}
          </section>

          <Splitter
            orientation="horizontal"
            label={t('layout.resizeEditor')}
            onDelta={(delta) => {
              // El delta se convierte a proporción con el alto de la columna.
              const alto = window.innerHeight;
              setEditorRatio(editorRatio + delta / alto);
            }}
            onKeyStep={(delta) => setEditorRatio(editorRatio + delta / window.innerHeight)}
          />

          <section className="min-h-0" style={{ flex: `${1 - editorRatio} 1 0%` }}>
            {output}
          </section>
        </main>

        <div className="hidden self-stretch lg:block">
          <Splitter
            orientation="vertical"
            label={t('layout.resizeRight')}
            onDelta={(delta) => setColumn('right', columns.right - delta)}
            onKeyStep={(delta) => setColumn('right', columns.right - delta)}
          />
        </div>

        <aside
          className="flex min-h-0 flex-col lg:overflow-hidden"
          style={{ width: anchoDerecha, flex: '0 0 auto' }}
        >
          {/*
            La zona con scroll pide lo que necesita y **no crece**: lo que sobra
            se lo queda la franja fija de abajo. Al revés —que era como
            estaba— el reto se pegaba al borde inferior con un hueco vacío
            encima suyo, y sus pruebas se apretaban en cuatro líneas mientras
            media columna estaba sin usar.
          */}
          <WidgetZone
            zone="guide"
            className="flex min-h-0 shrink flex-col gap-3 overflow-y-auto pr-1"
          />

          {/* El reparto entre lo que se desplaza y lo que se queja fijo también
              lo decide el usuario. Sin alto fijado, la franja pide el suyo. */}
          <Splitter
            orientation="horizontal"
            label={t('layout.resizeDock')}
            onDelta={ajustarFranja}
            onKeyStep={ajustarFranja}
          />

          <div
            className={
              'flex min-h-0 flex-col gap-3 ' +
              (dockHeight ? 'shrink-0 overflow-y-auto' : 'flex-1')
            }
            style={dockHeight ? { height: dockHeight } : undefined}
          >
            {complete}
            <WidgetZone zone="dock" className="flex min-h-0 flex-1 flex-col gap-3" />
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * Contenedor visual común de todos los paneles.
 *
 * `scroll` decide quién se queda con el desplazamiento. Un panel que vive
 * dentro de una zona ya desplazable debe pasar `scroll={false}`: dos barras
 * anidadas hacen que arrastrar la de fuera mueva unos píxeles y se pare,
 * porque el contenido se está desplazando por dentro.
 *
 * Y con `scroll={false}` el panel además **no puede encogerse**. Los dos
 * ajustes van juntos y por el mismo motivo: sin scroll propio nada recorta su
 * contenido, así que si el contenedor flex lo comprime —cosa que hace por
 * defecto— el texto se sale por abajo y se dibuja encima del panel siguiente.
 * Era justo lo que pasaba: la guía se derramaba sobre las pistas.
 */
export function Panel({
  title,
  action,
  children,
  className = '',
  scroll = true,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  return (
    <section
      className={
        'flex flex-col rounded-[var(--radius-panel)] border border-[var(--color-border)] ' +
        `bg-[var(--color-panel)] ${scroll ? 'min-h-0' : 'shrink-0'} ${className}`
      }
    >
      {title && (
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-ink-dim)]">
            {title}
          </h2>
          {action}
        </header>
      )}
      <div className={`min-h-0 flex-1 p-3 ${scroll ? 'overflow-y-auto' : ''}`}>{children}</div>
    </section>
  );
}
