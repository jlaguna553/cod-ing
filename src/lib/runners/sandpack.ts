import type { FileMap, LocalizedRuntimeSpec, OutputChunk, RunResult, Runner } from './types';
import { OutputEmitter, RunnerBootError } from './types';
import { DomMirror, MIRROR_PROBE } from './mirror';

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

  /** Copia legible del DOM del sandbox. Ver `mirror.ts` y el ADR-10. */
  private mirror: DomMirror;
  private onMessage: ((event: MessageEvent) => void) | null = null;
  private lastHtml: string | null = null;

  constructor(private readonly mount: HTMLElement) {
    this.mirror = new DomMirror(mount);
  }

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

    this.attachMirrorBridge();

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
          /*
           * La plantilla NO se puede dejar a la inferencia.
           *
           * Sin ella, el bundler no reconocía el proyecto y caía en `static`:
           * cargaba `main.js` como script clásico y todas las lecciones de
           * React y Vue morían con `Cannot use import statement outside a
           * module`. Se deduce de las extensiones, que es un dato que la
           * lección ya tiene.
           */
          template: detectTemplate(files),
          /*
           * Sin `@vue/compiler-sfc`, el bundler compila el `<script>` del SFC
           * y **no la plantilla**: la aplicación monta (`data-v-app` aparece)
           * y renderiza un comentario vacío, que es lo que hace Vue cuando un
           * componente no tiene función de render. Ni error ni aviso.
           */
          devDependencies:
            detectTemplate(files) === 'vue3-cli' ? { '@vue/compiler-sfc': '^3.5.0' } : {},
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
      artifacts: { document: () => this.getDocument() },
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
    if (this.onMessage) window.removeEventListener('message', this.onMessage);
    this.onMessage = null;
    this.mirror.dispose();
    this.client?.destroy();
    this.client = null;
    this.emitter.clear();
  }

  /**
   * El DOM del sandbox, a través del espejo.
   *
   * `client.iframe.contentDocument` es SIEMPRE `null`: el bundle se sirve
   * desde `*.codesandbox.io`, otro origen. Leerlo de ahí dejaba todas las
   * reglas `dom-assert` de React y Vue en «pendiente» desde que existen —
   * nunca en rojo, así que nada chilló.
   */
  getDocument(): Document | null {
    return this.mirror.getDocument();
  }

  /** Recoge el HTML que el sandbox manda y lo refleja. */
  private attachMirrorBridge() {
    if (this.onMessage) return;

    this.onMessage = (event: MessageEvent) => {
      const html = (event.data as { __codequestDom?: unknown } | null)?.__codequestDom;
      if (typeof html !== 'string' || html === this.lastHtml) return;
      this.lastHtml = html;
      void this.mirror.render(html);
    };

    window.addEventListener('message', this.onMessage);
  }

  /** Sandpack espera rutas absolutas y `{ code }` por archivo. */
  private toSandpackFiles(files: FileMap) {
    const entry = this.detectEntry(files);
    const template = detectTemplate(files);

    /*
     * Andamiaje que el bundler espera y la lección no tiene por qué escribir.
     *
     * `create-react-app` se apaña sin nada, pero `vue-cli` necesita su
     * `public/index.html` con el nodo de montaje y un `package.json` que
     * declare la dependencia: sin ellos no reconoce el proyecto y vuelve a
     * caer en el mismo error de módulos. Se añade aquí, no al workspace,
     * porque no es material de la lección — el usuario no debería tener que
     * mirarlo ni mantenerlo.
     */
    const scaffold: FileMap = {};
    if (!files['public/index.html'] && !files['/public/index.html']) {
      scaffold['/public/index.html'] =
        `<!doctype html><html><head><meta charset="utf-8" /></head>` +
        `<body><div id="${template === 'vue3-cli' ? 'app' : 'root'}"></div></body></html>`;
    }
    if (!files['package.json'] && !files['/package.json']) {
      scaffold['/package.json'] = JSON.stringify(
        { name: 'codequest-lesson', main: entry, dependencies: this.spec?.dependencies ?? {} },
        null,
        2,
      );
    }

    files = { ...scaffold, ...files };

    return Object.fromEntries(
      Object.entries(files).map(([path, code]) => {
        const absolute = path.startsWith('/') ? path : `/${path}`;
        /*
         * La sonda del espejo se pega al final del entry, que es el módulo que
         * monta la aplicación. Va aquí y no en el workspace porque el usuario
         * no debe verla: en el editor lee su archivo, sin andamiaje nuestro.
         */
        return [absolute, { code: absolute === entry ? `${code}\n${MIRROR_PROBE}` : code }];
      }),
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

/**
 * Plantilla del bundler, deducida de las extensiones del workspace.
 *
 * No se puede dejar a la inferencia de Sandpack: con solo `files` y
 * `dependencies` no reconocía el proyecto y caía en `static`, que sirve el
 * entry como script clásico. Síntoma: `Cannot use import statement outside a
 * module` y ni una sola lección de framework arrancando.
 */
export function detectTemplate(files: FileMap): 'vue3-cli' | 'create-react-app' | 'parcel' {
  const paths = Object.keys(files);
  /*
   * `vue3-cli`, no `vue-cli`: el segundo es Vue 2 y trata el entry como script
   * clásico, con lo que cualquier SFC con `<script setup>` moría en
   * `Cannot use import statement outside a module`. Se comprobó probando las
   * seis plantillas del bundler contra un SFC de Vue 3 — es la única que
   * compila y renderiza. El tipo del paquete no la lista; el bundler sí la
   * acepta.
   */
  if (paths.some((path) => path.endsWith('.vue'))) return 'vue3-cli';
  if (paths.some((path) => /\.(jsx|tsx)$/.test(path))) return 'create-react-app';
  return 'parcel';
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
