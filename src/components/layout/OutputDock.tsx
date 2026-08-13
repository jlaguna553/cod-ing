'use client';

import { useTranslations } from 'next-intl';
import { Eraser, Monitor, SquareTerminal, TerminalSquare } from 'lucide-react';
import type { RuntimeKind } from '@/lib/content/types';
import { defaultSurface, surfacesFor } from '@/lib/content/surfaces';
import { useLessonStore } from '@/stores/useLessonStore';
import { useRunnerStore } from '@/stores/useRunnerStore';
import { Panel } from './GameShell';
import { RunnerSurface } from '@/components/preview/RunnerSurface';

export function OutputDock({ runtimeKind = 'dom' }: { runtimeKind?: RuntimeKind }) {
  const t = useTranslations();
  const lesson = useLessonStore((s) => s.lesson);

  /*
   * El título nombra la herramienta que la lección usa de verdad. Antes decía
   * siempre «Vista previa» salvo en DevOps, así que una lección de consola
   * anunciaba una vista previa vacía.
   */
  const primary = lesson ? defaultSurface(surfacesFor(lesson)) : 'preview';
  const status = useRunnerStore((s) => s.status);
  const logs = useRunnerStore((s) => s.logs);
  const clearLogs = useRunnerStore((s) => s.clearLogs);

  return (
    <Panel
      className="h-full"
      title={
        <span className="flex items-center gap-2">
          {primary === 'terminal' ? (
            <TerminalSquare size={13} />
          ) : primary === 'console' ? (
            <SquareTerminal size={13} />
          ) : (
            <Monitor size={13} />
          )}
          {t(`panels.${primary}`)}
        </span>
      }
      action={
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          {logs.length > 0 && (
            <button
              type="button"
              onClick={clearLogs}
              title={t('runner.clear')}
              className="text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
            >
              <Eraser size={12} />
            </button>
          )}
          <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--color-ink-faint)]">
            {runtimeKind}
          </span>
        </div>
      }
    >
      <RunnerSurface />
    </Panel>
  );
}

function StatusDot({ status }: { status: ReturnType<typeof useRunnerStore.getState>['status'] }) {
  const color =
    status === 'ready'
      ? 'var(--color-success)'
      : status === 'running' || status === 'booting'
        ? 'var(--color-power)'
        : status === 'error'
          ? 'var(--color-damage)'
          : 'var(--color-ink-faint)';

  return (
    <span
      title={status}
      className={`size-1.5 rounded-full ${status === 'running' ? 'animate-pulse' : ''}`}
      style={{ backgroundColor: color }}
    />
  );
}
