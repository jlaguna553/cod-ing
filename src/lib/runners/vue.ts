import type { FileMap, LocalizedRuntimeSpec, RunResult, Runner } from './types';
import { OutputEmitter, RunnerBootError } from './types';
import { DomMirror, MIRROR_PROBE } from './mirror';
import { buildModules } from './vue-sfc';

/**
 * Vue en el navegador, sin bundler y sin terceros (ADR-13).
 *
 * Reemplaza a Sandpack para las lecciones de Vue por dos motivos, y el segundo
 * pesa más que el primero:
 *
 * 1. **Sandpack no compila la plantilla de un SFC de Vue 3.** Se probaron sus
 *    seis plantillas contra un componente mínimo: ninguna renderiza. El
 *    componente monta sin función de render y Vue pinta un comentario vacío.
 * 2. **No depende de nada de fuera.** El bundler de Sandpack vive en
 *    `codesandbox.io`: si ese dominio está caído, bloqueado por una red
 *    corporativa o deja de ser gratuito, la lección no arranca. Aquí el
 *    runtime de Vue son 168 KB servidos desde nuestro propio origen.
 *
 * El resto de la mecánica es la del runner de DOM: iframe con
 * `sandbox="allow-scripts"` y un espejo legible para que la evaluación pueda
 * mirar el resultado (ADR-10).
 */

const VUE_RUNTIME_URL = '/vendor/vue.esm-browser.prod.js';

/**
 * Módulo que arranca la aplicación.
 *
 * NO es `workspace.entry`: ese campo dice qué archivo se abre en el editor, y
 * en una lección de Vue es el componente que se edita. Importar un componente
 * solo lo define — quien monta es `main.js`, así que la pantalla se quedaba en
 * blanco sin un solo error.
 */
export function detectBootstrap(files: FileMap, entry?: string): string {
  const paths = Object.keys(files).map((path) => (path.startsWith('/') ? path : `/${path}`));

  for (const candidate of ['/src/main.js', '/src/main.ts', '/src/index.js', '/main.js']) {
    if (paths.includes(candidate)) return candidate;
  }
  if (entry) return entry.startsWith('/') ? entry : `/${entry}`;
  return paths[0] ?? '/src/main.js';
}

export class VueRunner implements Runner {
  readonly kind = 'vue' as const;

  private iframe: HTMLIFrameElement | null = null;
  private mirror: DomMirror;
  private files: FileMap = {};
  private entry = '/src/main.js';
  private emitter = new OutputEmitter();
  private onMessage: ((event: MessageEvent) => void) | null = null;
  private vueRuntime: string | null = null;
  private lastHtml: string | null = null;

  constructor(private readonly mount: HTMLElement) {
    this.mirror = new DomMirror(mount);
  }

  async boot(_spec: LocalizedRuntimeSpec, files: FileMap, entry?: string): Promise<void> {
    this.files = { ...files };
    this.entry = detectBootstrap(files, entry);

    /*
     * El runtime se lee una vez y se reutiliza. Va inline en el documento y no
     * como `<script src>`: el iframe tiene origen opaco, así que cualquier
     * petición suya a nuestro servidor sería de otro origen y la bloquearía
     * el navegador.
     */
    try {
      const response = await fetch(VUE_RUNTIME_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.vueRuntime = await response.text();
    } catch (cause) {
      throw new RunnerBootError(
        `No se pudo cargar el runtime de Vue desde ${VUE_RUNTIME_URL}. ` +
          'Lo copia `scripts/copy-vendor.ts` en cada build.',
        cause,
      );
    }

    this.attachBridge();
    this.emitter.emit('system', 'Vue listo\n');
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files[path] = content;
  }

  async run(): Promise<RunResult> {
    const startedAt = Date.now();
    this.mirror.clear();
    this.lastHtml = null;

    let document_: string;
    try {
      const { modules, entryId } = await buildModules(
        this.files,
        this.entry,
        this.vueRuntime ?? '',
      );
      document_ = assembleDocument(modules, entryId);
    } catch (cause) {
      /*
       * Un error de compilación es del usuario, no del sistema: se enseña tal
       * cual, con el archivo y la línea que da el compilador de Vue.
       */
      const message = cause instanceof Error ? cause.message : String(cause);
      this.emitter.emit('stderr', `${message}\n`);
      return { exitCode: 1, stdout: '', stderr: message, durationMs: Date.now() - startedAt };
    }

    const iframe = window.document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('title', 'preview');
    iframe.style.cssText = 'width:100%;height:100%;border:0;background:#fff';

    this.iframe?.remove();
    this.iframe = iframe;
    this.mount.appendChild(iframe);
    // `srcdoc` DESPUÉS de insertar: al revés, los scripts no llegan a correr.
    iframe.srcdoc = document_;

    return {
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: Date.now() - startedAt,
      artifacts: { document: () => this.getDocument() },
    };
  }

  onOutput(cb: Parameters<OutputEmitter['on']>[0]) {
    return this.emitter.on(cb);
  }

  async reset(): Promise<void> {
    this.iframe?.remove();
    this.iframe = null;
    this.mirror.clear();
  }

  dispose(): void {
    if (this.onMessage) window.removeEventListener('message', this.onMessage);
    this.onMessage = null;
    this.iframe?.remove();
    this.iframe = null;
    this.mirror.dispose();
    this.emitter.clear();
  }

  getDocument(): Document | null {
    return this.mirror.getDocument();
  }

  private attachBridge() {
    if (this.onMessage) return;

    this.onMessage = (event: MessageEvent) => {
      const data = event.data as { __codequestDom?: unknown; __codequestLog?: unknown } | null;
      if (!data) return;

      if (typeof data.__codequestLog === 'string') {
        this.emitter.emit('stdout', `${data.__codequestLog}\n`);
      }

      const html = data.__codequestDom;
      if (typeof html === 'string' && html !== this.lastHtml) {
        this.lastHtml = html;
        void this.mirror.render(html);
      }
    };

    window.addEventListener('message', this.onMessage);
  }
}

/**
 * Documento que monta el grafo de módulos con `import()` nativo.
 *
 * Los blobs se crean **dentro** del iframe y en orden de dependencia: cada
 * módulo sustituye sus marcadores `@@id@@` por la URL del blob que ya existe.
 * Es lo que evita necesitar un import map, que tendría que estar completo
 * antes de evaluar el primer módulo.
 */
export function assembleDocument(
  modules: Array<{ id: string; code: string }>,
  entryId: string,
): string {
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body>
<div id="app"></div>
<script>
${MIRROR_PROBE}
// La consola del usuario viaja al anfitrión: es su única salida de texto.
(function () {
  var original = console.log;
  console.log = function () {
    var text = Array.prototype.map
      .call(arguments, function (value) {
        try { return typeof value === 'object' ? JSON.stringify(value) : String(value); }
        catch (error) { return String(value); }
      })
      .join(' ');
    (window.top || parent).postMessage({ __codequestLog: text }, '*');
    original.apply(console, arguments);
  };
  window.addEventListener('error', function (event) {
    (window.top || parent).postMessage(
      { __codequestLog: 'Error: ' + (event.message || 'desconocido') },
      '*',
    );
  });
})();
</script>
<script type="module">
const MODULES = ${JSON.stringify(modules)};
const urls = Object.create(null);

for (const module of MODULES) {
  const code = module.code.replace(/@@([^@]+)@@/g, (match, id) => urls[id] ?? match);
  urls[module.id] = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
}

import(urls[${JSON.stringify(entryId)}]).catch((error) => {
  (window.top || parent).postMessage({ __codequestLog: 'Error: ' + error.message }, '*');
});
</script>
</body>
</html>`;
}
