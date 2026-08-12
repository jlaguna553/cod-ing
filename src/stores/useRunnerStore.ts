import { create } from 'zustand';
import type { LocalizedRuntimeSpec, OutputChunk, RunResult, Runner, RuntimeKind } from '@/lib/runners/types';
import { createRunner } from '@/lib/runners/factory';

/**
 * Estado del runner activo.
 *
 * La instancia del runner NO vive en el store de Zustand: es un objeto mutable
 * con un iframe dentro y un ciclo de vida propio, y meterlo en el estado haría
 * que cualquier suscriptor se re-renderizara por cosas que no mira. Se guarda
 * en una variable de módulo y el store solo refleja su estado observable.
 */
let activeRunner: Runner | null = null;
let activeKind: RuntimeKind | null = null;

/**
 * Shell acoplada al runner activo, cuando la lección activa `runtime.terminal`.
 *
 * Vive aparte del runner a propósito: la terminal es una **capacidad**, no un
 * tipo de runtime. Así una lección de React con Sandpack puede tener consola
 * sin renunciar a su vista previa, y una de DevOps puede tener consola sin
 * necesitar preview alguno.
 */
let activeShell: import('@/lib/runners/cli-sim').Shell | null = null;

export interface LogLine {
  stream: OutputChunk['stream'];
  text: string;
  at: number;
}

interface RunnerState {
  status: 'idle' | 'booting' | 'ready' | 'running' | 'error';
  kind: RuntimeKind | null;
  logs: LogLine[];
  lastResult: RunResult | null;
  error: string | null;

  /** true si la lección activa tiene consola. */
  hasTerminal: boolean;
  /** Archivos generados por comandos, para que el árbol los muestre. */
  generatedFiles: Record<string, string>;

  boot: (kind: RuntimeKind, spec: LocalizedRuntimeSpec, files: Record<string, string>, mount: HTMLElement, entry?: string) => Promise<void>;
  syncFile: (path: string, content: string) => Promise<void>;
  execute: (command?: string) => Promise<RunResult | null>;
  runCommand: (command: string) => Promise<RunResult | null>;
  clearLogs: () => void;
  teardown: () => void;
}

/** Techo del buffer: una lección larga no puede acumular megas de logs. */
const MAX_LOGS = 500;

export const useRunnerStore = create<RunnerState>()((set, get) => ({
  status: 'idle',
  kind: null,
  logs: [],
  lastResult: null,
  error: null,
  hasTerminal: false,
  generatedFiles: {},

  boot: async (kind, spec, files, mount, entry) => {
    // Cambiar de lección con el mismo runtime no justifica reconstruirlo.
    if (activeRunner && activeKind === kind) {
      set({ status: 'ready', kind });
      return;
    }

    get().teardown();
    set({ status: 'booting', kind, logs: [], error: null, lastResult: null });

    try {
      const runner = await createRunner(kind, mount);

      runner.onOutput((chunk) => {
        set((state) => ({
          logs: [...state.logs, { ...chunk, text: chunk.data, at: Date.now() }].slice(-MAX_LOGS),
        }));
      });

      await runner.boot(spec, files, entry);
      activeRunner = runner;
      activeKind = kind;

      // La consola se compone aparte cuando la lección la pide y el runner no
      // la trae de serie (`cli-sim` ya es una shell por dentro).
      const wantsTerminal = spec.terminal?.enabled === true;
      if (wantsTerminal && kind !== 'cli-sim') {
        const { Shell, VirtualFs } = await import('@/lib/runners/cli-sim');
        activeShell = new Shell(new VirtualFs(files), spec.terminal?.allowedCommands ?? []);
      }

      set({ status: 'ready', hasTerminal: wantsTerminal || kind === 'cli-sim' });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      set({ status: 'error', error: message });
    }
  },

  syncFile: async (path, content) => {
    await activeRunner?.writeFile(path, content);
    activeShell?.getFs().write(path, content);
  },

  /**
   * Ejecuta un comando en la consola.
   *
   * Los archivos que el comando crea se propagan al runner de preview, que es
   * lo que hace que `npm create vite` seguido de editar `App.jsx` funcione:
   * la shell escribe el proyecto y el preview lo monta. Sin esta propagación
   * la terminal sería decorativa.
   */
  runCommand: async (command) => {
    // `cli-sim` es una shell por dentro: su propio `run` ya ejecuta comandos.
    if (!activeShell) return get().execute(command);

    const startedAt = Date.now();
    set((state) => ({
      logs: [...state.logs, { stream: 'stdout' as const, text: `${command}\n`, at: Date.now() }].slice(-MAX_LOGS),
    }));

    const result = activeShell.execute(command);

    const lines: LogLine[] = [];
    if (result.stdout) lines.push({ stream: 'stdout', text: `${result.stdout}\n`, at: Date.now() });
    if (result.stderr) lines.push({ stream: 'stderr', text: `${result.stderr}\n`, at: Date.now() });
    lines.push({ stream: 'system', text: `${activeShell.getCwd()} $ `, at: Date.now() });

    const generated: Record<string, string> = {};
    for (const path of result.touched) {
      const content = activeShell.getFs().read(path);
      if (content === null) continue;
      generated[path] = content;
      await activeRunner?.writeFile(path, content);
    }

    set((state) => ({
      logs: [...state.logs, ...lines].slice(-MAX_LOGS),
      generatedFiles: { ...state.generatedFiles, ...generated },
    }));

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
      artifacts: { transcript: activeShell.getTranscript(), touched: result.touched },
    };
  },

  execute: async (command) => {
    if (!activeRunner || get().status === 'booting') return null;

    set({ status: 'running' });
    try {
      const result = await activeRunner.run(command);
      set({ status: 'ready', lastResult: result });
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      set({ status: 'error', error: message });
      return null;
    }
  },

  clearLogs: () => set({ logs: [] }),

  teardown: () => {
    activeRunner?.dispose();
    activeRunner = null;
    activeKind = null;
    activeShell = null;
    set({
      status: 'idle',
      kind: null,
      logs: [],
      lastResult: null,
      error: null,
      hasTerminal: false,
      generatedFiles: {},
    });
  },
}));

/** Acceso directo al runner, para el motor de evaluación de la Fase 4. */
export function getActiveRunner(): Runner | null {
  return activeRunner;
}

/** Transcripción de comandos, para la regla `cli-transcript` de la Fase 4. */
export function getTranscript(): string[] {
  if (activeShell) return activeShell.getTranscript();
  const runner = activeRunner as { getTranscript?: () => string[] } | null;
  return runner?.getTranscript?.() ?? [];
}
