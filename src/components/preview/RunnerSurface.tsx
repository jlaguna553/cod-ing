'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Loader2, Monitor, SquareTerminal, TerminalSquare } from 'lucide-react';
import { usesTerminal } from '@/lib/runners/factory';
import { useLessonStore } from '@/stores/useLessonStore';
import { useRunnerStore } from '@/stores/useRunnerStore';
import { XtermPane } from '@/components/terminal/XtermPane';
import { ConsolePane } from './ConsolePane';

type Tab = 'preview' | 'console' | 'terminal';

/**
 * Superficie de ejecución: arranca el runner de la lección y le da su punto de
 * montaje. Es el único componente de la app que sabe que existen runners
 * distintos (ADR-02).
 *
 * Preview y terminal pueden convivir: la terminal es una capacidad del runtime
 * (`runtime.terminal.enabled`), no un tipo de runner. Cuando ambos están
 * activos se muestran en pestañas y el iframe **no se desmonta** al cambiar de
 * pestaña — solo se oculta. Desmontarlo perdería el estado de la aplicación
 * que el usuario está construyendo, que es justo lo que venía a ver.
 */
export function RunnerSurface() {
  const t = useTranslations();
  const mountRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('preview');

  const lesson = useLessonStore((s) => s.lesson);
  const files = useLessonStore((s) => s.files);
  const status = useRunnerStore((s) => s.status);
  const error = useRunnerStore((s) => s.error);
  const hasTerminal = useRunnerStore((s) => s.hasTerminal);
  const boot = useRunnerStore((s) => s.boot);
  const teardown = useRunnerStore((s) => s.teardown);

  const kind = lesson?.runtime.kind ?? null;
  const terminalOnly = kind ? usesTerminal(kind) : false;
  const logCount = useRunnerStore((s) => s.logs.length);

  useEffect(() => {
    if (!lesson || !mountRef.current) return;
    void boot(lesson.runtime.kind, lesson.runtime, files, mountRef.current, lesson.workspace.entry);
    return () => teardown();
    // Rearrancar en cada tecleo sería absurdo: solo al cambiar de lección.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.id]);

  useEffect(() => {
    if (terminalOnly) setTab('terminal');
  }, [terminalOnly]);

  if (!lesson) {
    return (
      <div className="flex h-full items-center justify-center rounded border border-dashed border-[var(--color-border)] bg-[var(--color-void)]">
        <p className="text-xs text-[var(--color-ink-faint)]">{t('empty.noLesson')}</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 rounded border border-[var(--color-damage)]/40 bg-[var(--color-damage)]/5 p-4 text-center">
        <AlertTriangle size={18} className="text-[var(--color-damage)]" />
        <p className="max-w-sm text-xs leading-relaxed text-[var(--color-ink-dim)]">{error}</p>
      </div>
    );
  }

  // La consola se ofrece siempre que haya vista previa: las lecciones de
  // JavaScript imprimen con `console.log` y su salida no cabe en un iframe.
  const showTabs = !terminalOnly;
  const showTerminal = terminalOnly || (hasTerminal && tab === 'terminal');
  const showConsole = !terminalOnly && tab === 'console';

  return (
    <div className="flex h-full flex-col gap-2">
      {showTabs && (
        <div className="flex shrink-0 gap-1">
          <TabButton active={tab === 'preview'} onClick={() => setTab('preview')} icon={<Monitor size={11} />}>
            {t('panels.preview')}
          </TabButton>
          <TabButton active={tab === 'console'} onClick={() => setTab('console')} icon={<SquareTerminal size={11} />}>
            {t('panels.console')}
            {logCount > 0 && (
              <span className="ml-1 rounded-full bg-[var(--color-neon)]/20 px-1.5 font-mono text-[9px] text-[var(--color-neon)]">
                {logCount}
              </span>
            )}
          </TabButton>
          {hasTerminal && (
            <TabButton active={tab === 'terminal'} onClick={() => setTab('terminal')} icon={<TerminalSquare size={11} />}>
              {t('panels.terminal')}
            </TabButton>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-void)]">
        {/* Siempre montado: ocultarlo conserva el estado de la app del usuario. */}
        {/*
          Oculto con `opacity-0`, NO con `visibility:hidden`.
          
          Chrome retrasa (y a veces omite) la carga de iframes cuya visibilidad
          está anulada. Con `invisible`, pulsar «Ejecutar» estando en la pestaña
          de consola dejaba el código sin ejecutar y la salida nunca aparecía.
          Con opacidad cero el iframe sigue siendo un elemento renderizado para
          el navegador, solo que no se ve.
        */}
        <div
          ref={mountRef}
          className={
            terminalOnly || showTerminal || showConsole
              ? 'pointer-events-none absolute inset-0 opacity-0'
              : 'h-full w-full'
          }
        />

        {showConsole && <ConsolePane />}

        {hasTerminal && (
          <div
            className={
              showTerminal
                ? 'h-full w-full'
                : 'pointer-events-none absolute inset-0 opacity-0'
            }
          >
            {status !== 'booting' && <XtermPane />}
          </div>
        )}

        {status === 'booting' && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-[var(--color-void)]/90">
            <Loader2 size={14} className="animate-spin text-[var(--color-neon)]" />
            <span className="text-xs text-[var(--color-ink-dim)]">{t('runner.booting')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ' +
        (active
          ? 'bg-[var(--color-raised)] text-[var(--color-neon)]'
          : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]')
      }
    >
      {icon}
      {children}
    </button>
  );
}
