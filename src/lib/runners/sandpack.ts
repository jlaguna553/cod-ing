import type { FileMap, LocalizedRuntimeSpec, OutputChunk, RunResult, Runner } from './types';
import { OutputEmitter, RunnerBootError } from './types';

type SandpackClient = {
  updateSandbox: (files: unknown) => void;
  listen: (cb: (message: { type: string; [key: string]: unknown }) => void) => () => void;
  destroy: () => void;
  iframe: HTMLIFrameElement;
};

/**
 * Runner de React/Vue vía Sandpack.
 *
 * Cubre las lecciones de framework que NO instalan nada (react-01 a react-03,
 * react-10, vue-03). Sandpack empaqueta en el navegador y arranca en un par de
 * segundos, frente a la media hora larga de un `npm install` real.
 *
 * Límite conocido y deliberado: **Sandpack no tiene npm ni shell**. En cuanto
 * una lección pide instalar algo o teclear un comando, el runtime correcto es
 * `webcontainer` (ADR-07). Por eso `react-04` es la única de React que no usa
 * este runner.
 *
 * Dependencia de red: el bundler de Sandpack se descarga de su CDN en el
 * primer arranque. Es la razón de que el `boot` pueda fallar con un mensaje
 * propio en lugar de quedarse colgado.
 */
export class SandpackRunner implements Runner {
  readonly kind = 'sandpack' as const;

  private client: SandpackClient | null = null;
  private files: FileMap = {};
  private emitter = new OutputEmitter();
  private unlisten: (() => void) | null = null;
  private spec: LocalizedRuntimeSpec | null = null;

  constructor(private readonly mount: HTMLElement) {}

  async boot(spec: LocalizedRuntimeSpec, files: FileMap): Promise<void> {
    this.spec = spec;
    this.files = { ...files };

    // Import dinámico: el cliente de Sandpack pesa y solo hace falta en las
    // lecciones de framework, no en las 8 que usan el runner de DOM.
    const { loadSandpackClient } = await import('@codesandbox/sandpack-client').catch(
      (cause) => {
        throw new RunnerBootError('No se pudo cargar el cliente de Sandpack', cause);
      },
    );

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;height:100%;border:0;background:#fff';
    this.mount.replaceChildren(iframe);

    try {
      this.client = (await loadSandpackClient(
        iframe,
        {
          files: this.toSandpackFiles(files),
          // El `entry` SIEMPRE: Sandpack no puede empaquetar sin él. Antes se
          // omitía cuando la lección declaraba `previewPort`, pero ese campo
          // describe el puerto de un servidor de desarrollo (WebContainers) y
          // no tiene nada que ver con el punto de entrada del bundler — el
          // resultado era que vue-03 no arrancaba.
          entry: this.detectEntry(files),
          dependencies: spec.dependencies,
        } as never,
        { showOpenInCodeSandbox: false },
      )) as unknown as SandpackClient;
    } catch (cause) {
      throw new RunnerBootError(
        'Sandpack no pudo arrancar. Requiere conexión para descargar el bundler.',
        cause,
      );
    }

    this.unlisten = this.client.listen((message) => {
      if (message.type === 'console') {
        for (const entry of (message.log as { method: string; data: unknown[] }[]) ?? []) {
          const text = entry.data.map((value) => stringify(value)).join(' ');
          this.emitter.emit(entry.method === 'error' ? 'stderr' : 'stdout', `${text}\n`);
        }
      }
      if (message.type === 'action' && message.action === 'show-error') {
        this.emitter.emit('stderr', `${String(message.message ?? 'Error de compilación')}\n`);
      }
    });

    this.emitter.emit('system', 'Sandpack listo\n');
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files[path] = content;
    this.client?.updateSandbox({
      files: this.toSandpackFiles(this.files),
      dependencies: this.spec?.dependencies ?? {},
    });
  }

  async run(): Promise<RunResult> {
    const startedAt = performance.now();
    // Sandpack recompila al escribir; "ejecutar" es forzar una actualización.
    this.client?.updateSandbox({
      files: this.toSandpackFiles(this.files),
      dependencies: this.spec?.dependencies ?? {},
    });

    return {
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: Math.round(performance.now() - startedAt),
      artifacts: { document: () => this.client?.iframe.contentDocument ?? null },
    };
  }

  onOutput(cb: (chunk: OutputChunk) => void) {
    return this.emitter.on(cb);
  }

  async reset(): Promise<void> {
    this.client?.updateSandbox({
      files: this.toSandpackFiles(this.files),
      dependencies: this.spec?.dependencies ?? {},
    });
  }

  dispose(): void {
    this.unlisten?.();
    this.client?.destroy();
    this.client = null;
    this.emitter.clear();
  }

  getDocument(): Document | null {
    return this.client?.iframe.contentDocument ?? null;
  }

  /** Sandpack espera rutas absolutas y `{ code }` por archivo. */
  private toSandpackFiles(files: FileMap) {
    return Object.fromEntries(
      Object.entries(files).map(([path, code]) => [
        path.startsWith('/') ? path : `/${path}`,
        { code },
      ]),
    );
  }

  /**
   * Punto de entrada del bundler.
   *
   * Se prueban los nombres convencionales por orden y, si ninguno está, se
   * cae al primer fichero de código del workspace. Devolver algo siempre
   * importa: sin `entry`, Sandpack falla con un error que el usuario ve como
   * un preview en blanco sin explicación.
   */
  private detectEntry(files: FileMap): string {
    const candidates = [
      '/src/main.jsx', '/src/main.js', '/src/main.ts',
      '/src/index.jsx', '/src/index.js',
      '/index.jsx', '/index.js',
    ];
    const available = Object.keys(files).map((path) => (path.startsWith('/') ? path : `/${path}`));

    const conventional = candidates.find((candidate) => available.includes(candidate));
    if (conventional) return conventional;

    const anyCode = available.find((path) => /\.(jsx?|tsx?)$/.test(path));
    return anyCode ?? available[0] ?? '/index.js';
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
