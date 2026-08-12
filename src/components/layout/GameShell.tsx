import type { ReactNode } from 'react';

/**
 * Layout de la pantalla de juego.
 *
 *   ┌──────────┬───────────────────────────┬──────────┐
 *   │ Left     │   CodeCanvas (hero)       │ Right    │
 *   │ FileTree │                           │ Steps    │
 *   │ XP/Nivel ├───────────────────────────┤ Hints    │
 *   │ Energía  │   OutputDock              │ Tests    │
 *   │ Idioma   │   (preview | terminal)    │          │
 *   └──────────┴───────────────────────────┴──────────┘
 *
 * Grid de altura fija (100dvh) y `min-h-0` en las celdas: es lo que permite
 * que Monaco y Xterm midan su propio alto y hagan scroll interno en vez de
 * empujar la página. Sin `min-h-0` el editor crece sin límite y rompe el layout.
 */
export function GameShell({
  left,
  right,
  editor,
  output,
}: {
  left: ReactNode;
  right: ReactNode;
  editor: ReactNode;
  output: ReactNode;
}) {
  return (
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[1fr_auto] gap-3 p-3 lg:grid-cols-[280px_minmax(0,1fr)_360px] lg:grid-rows-1">
      <aside className="hidden min-h-0 flex-col gap-3 overflow-y-auto lg:flex">{left}</aside>

      <main className="grid min-h-0 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
        <section className="min-h-0">{editor}</section>
        <section className="min-h-0">{output}</section>
      </main>

      <aside className="min-h-0 overflow-y-auto">{right}</aside>
    </div>
  );
}

/** Contenedor visual común de todos los paneles. */
export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-panel)] ${className}`}
    >
      {title && (
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-ink-dim)]">
            {title}
          </h2>
          {action}
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </section>
  );
}
