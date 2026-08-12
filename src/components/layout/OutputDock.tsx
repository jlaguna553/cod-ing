'use client';

import { useTranslations } from 'next-intl';
import { Eraser, Monitor, TerminalSquare } from 'lucide-react';
import type { RuntimeKind } from '@/lib/content/types';
import { usesTerminal } from '@/lib/runners/factory';
import { useRunnerStore } from '@/stores/useRunnerStore';
import { Panel } from './GameShell';
import { RunnerSurface } from '@/components/preview/RunnerSurface';

export function OutputDock({ runtimeKind = 'dom' }: { runtimeKind?: RuntimeKind }) {
  const t = useTranslations();
  const isTerminal = usesTerminal(runtimeKind);
  const status = useRunnerStore((s) => s.status);
  const logs = useRunnerStore((s) => s.logs);
  const clearLogs = useRunnerStore((s) => s.clearLogs);

  return (
    <Panel
      className="h-full"
      title={
        <span className="flex items-center gap-2">
          {isTerminal ? <TerminalSquare size={13} /> : <Monitor size={13} />}
          {isTerminal ? t('panels.terminal') : t('panels.preview')}
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
