/**
 * Contrato único de ejecución (ADR-02).
 *
 * Las seis implementaciones —DOM, Sandpack, WebContainers, Pyodide, runner
 * remoto y simulador de CLI— exponen esto y nada más. La UI solo distingue
 * entre ellas por `kind`, para decidir si pinta un iframe o una terminal.
 */
export type {
  LocalizedRuntimeSpec,
  FileMap,
  OutputChunk,
  RunResult,
  Runner,
  RuntimeKind,
  RuntimeSpec,
  Unsubscribe,
} from '@/lib/content/types';

/** Estado del ciclo de vida, para que la UI sepa qué mostrar. */
export type RunnerStatus =
  | 'idle'        // creado, sin arrancar
  | 'booting'     // instalando dependencias, cargando WASM…
  | 'ready'       // listo para ejecutar
  | 'running'     // ejecución en curso
  | 'error';      // el arranque falló; `error` explica por qué

export class RunnerBootError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RunnerBootError';
  }
}

/** Emisor mínimo de salida, compartido por todas las implementaciones. */
export class OutputEmitter {
  private listeners = new Set<(chunk: import('@/lib/content/types').OutputChunk) => void>();

  on(cb: (chunk: import('@/lib/content/types').OutputChunk) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  emit(stream: 'stdout' | 'stderr' | 'system', data: string) {
    for (const listener of this.listeners) listener({ stream, data });
  }

  clear() {
    this.listeners.clear();
  }
}
