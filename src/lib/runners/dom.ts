import type { FileMap, LocalizedRuntimeSpec, OutputChunk, RunResult, Runner } from './types';
import { OutputEmitter } from './types';

/**
 * Runner de HTML/CSS/JS puro sobre un iframe aislado.
 *
 * Cubre 8 de las 15 lecciones actuales (todo HTML, CSS y JavaScript) y no
 * necesita bundler, WASM ni red. Por eso va primero: es el que más contenido
 * desbloquea por unidad de riesgo.
 *
 * Aislamiento: el iframe se sirve con `sandbox="allow-scripts"` y SIN
 * `allow-same-origin`. Esa combinación le da un origen opaco, así que el
 * código del usuario no puede tocar `localStorage`, cookies ni el DOM de la
 * aplicación — aunque el código sea suyo, un `while(true)` o un `alert` en
 * bucle no deben poder secuestrar la plataforma entera.
 */
export class DomRunner implements Runner {
  readonly kind = 'dom' as const;

  private iframe: HTMLIFrameElement | null = null;
  private files: FileMap = {};
  private spec: LocalizedRuntimeSpec | null = null;
  private emitter = new OutputEmitter();
  private pending: { resolve: (result: RunResult) => void; startedAt: number } | null = null;
  private buffer: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };
  private messageHandler: ((event: MessageEvent) => void) | null = null;

  /** Token de sesión: descarta mensajes de iframes anteriores ya descartados. */
  private token = 0;

  /** Archivo de entrada de la lección, para las que no traen `index.html`. */
  private entry: string | null = null;

  constructor(private readonly mount: HTMLElement) {}

  async boot(spec: LocalizedRuntimeSpec, files: FileMap, entry?: string): Promise<void> {
    this.spec = spec;
    this.files = { ...files };
    this.entry = entry ?? null;
    this.attachMessageHandler();
    this.emitter.emit('system', 'Preview listo');
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files[path] = content;
  }

  /**
   * Reconstruye el documento y lo carga en un iframe nuevo.
   *
   * Se crea un iframe nuevo en cada ejecución en vez de reutilizarlo: es la
   * única forma barata de garantizar que no sobreviven timers, listeners ni
   * variables globales del intento anterior. Reutilizarlo produce ese bug
   * desconcertante en el que el código arreglado "sigue fallando".
   */
  async run(): Promise<RunResult> {
    const startedAt = performance.now();
    this.buffer = { stdout: [], stderr: [] };
    this.token += 1;

    const document = this.buildDocument(this.token);

    return new Promise<RunResult>((resolve) => {
      this.pending = { resolve, startedAt };

      const iframe = window.document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('title', 'preview');
      iframe.style.cssText = 'width:100%;height:100%;border:0;background:#fff';

      this.iframe?.remove();
      this.iframe = iframe;
      this.mount.appendChild(iframe);

      /*
       * `srcdoc` se asigna DESPUÉS de insertar el iframe en el documento.
       *
       * Al revés, el navegador arranca la carga en un contexto que aún no está
       * conectado y lo descarta al insertarlo: el HTML acababa correcto en el
       * atributo pero **sus scripts no llegaban a ejecutarse**. El síntoma era
       * desconcertante — la consola muda y la comprobación de salida en rojo,
       * con el código del usuario perfectamente visible en el `srcdoc`.
       */
      iframe.srcdoc = document;

      // Red de seguridad: si el script del usuario nunca acaba (bucle infinito,
      // excepción antes del aviso), la promesa se resolvería nunca.
      const timeout = this.spec?.timeoutMs ?? 5000;
      window.setTimeout(() => {
        if (this.pending?.startedAt === startedAt) this.settle(0, 'timeout');
      }, timeout);
    });
  }

  onOutput(cb: (chunk: OutputChunk) => void) {
    return this.emitter.on(cb);
  }

  async reset(): Promise<void> {
    this.iframe?.remove();
    this.iframe = null;
    this.buffer = { stdout: [], stderr: [] };
  }

  dispose(): void {
    if (this.messageHandler) window.removeEventListener('message', this.messageHandler);
    this.messageHandler = null;
    this.iframe?.remove();
    this.iframe = null;
    this.emitter.clear();
  }

  /** El documento vivo, para que el motor evalúe las reglas `dom-assert`. */
  getDocument(): Document | null {
    return this.iframe?.contentDocument ?? null;
  }

  /* ── interno ─────────────────────────────────────────────────── */

  private attachMessageHandler() {
    if (this.messageHandler) return;

    this.messageHandler = (event: MessageEvent) => {
      const data = event.data;
      // El origen es opaco ("null") por el sandbox, así que no sirve para
      // filtrar: se usa un token propio para descartar iframes viejos.
      if (!data || data.__codequest !== this.token) return;

      if (data.type === 'console') {
        const stream = data.level === 'error' ? 'stderr' : 'stdout';
        this.buffer[stream].push(data.text);
        this.emitter.emit(stream, `${data.text}\n`);
      }

      if (data.type === 'done') this.settle(0);
      if (data.type === 'error') {
        this.buffer.stderr.push(data.text);
        this.emitter.emit('stderr', `${data.text}\n`);
        this.settle(1);
      }
    };

    window.addEventListener('message', this.messageHandler);
  }

  private settle(exitCode: number, note?: string) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;

    if (note === 'timeout') {
      this.emitter.emit('stderr', 'La ejecución superó el tiempo límite.\n');
    }

    pending.resolve({
      exitCode: note === 'timeout' ? 124 : exitCode,
      stdout: this.buffer.stdout.join('\n'),
      stderr: this.buffer.stderr.join('\n'),
      durationMs: Math.round(performance.now() - pending.startedAt),
      artifacts: { document: () => this.getDocument() },
    });
  }

  private buildDocument(token: number): string {
    return assembleDocument(this.files, token, this.entry ?? undefined);
  }
}

/**
 * Ensambla los archivos del workspace en un único documento.
 *
 * `<link>` y `<script src>` no pueden resolverse: dentro de un `srcdoc` con
 * origen opaco no hay red ni rutas relativas. Se sustituyen por el contenido
 * real de los archivos antes de inyectarlo.
 *
 * Función exportada y pura para poder probarla sin navegador: es la pieza del
 * runner donde de verdad puede haber errores sutiles.
 */
export function assembleDocument(files: FileMap, token: number, entry?: string): string {
  const bridge = consoleBridge(token);

  /*
   * Sin `index.html` hay que fabricar uno.
   *
   * Una lección puede traer solo un `.js` —`js-01` y `js-02` son así— y sin
   * este caso su código NUNCA se ejecutaba: no existía ningún `<script src>`
   * que sustituir, así que el documento salía vacío, la consola muda y la
   * comprobación de salida en rojo sin explicación posible.
   */
  const html = files['index.html'] ?? synthesizeHtml(files, entry);

  const withStyles = html.replace(
    /<link[^>]+href=["']\.?\/?([^"']+\.css)["'][^>]*>/gi,
    (match, href: string) => {
      const css = files[href] ?? files[`./${href}`];
      return css ? `<style>\n${css}\n</style>` : match;
    },
  );

  const withScripts = withStyles.replace(
    /<script[^>]*src=["']\.?\/?([^"']+\.js)["'][^>]*><\/script>/gi,
    (match, src: string) => {
      const js = files[src] ?? files[`./${src}`];
      return js ? `<script type="module">\n${js}\n</script>` : match;
    },
  );

  // El puente de consola va en <head> para capturar también lo que ocurra
  // durante el parseo del propio documento.
  return withScripts.includes('<head>')
    ? withScripts.replace('<head>', `<head>${bridge}`)
    : `${bridge}${withScripts}`;
}

/**
 * Reenvía `console.*` y los errores del iframe a la ventana anfitriona.
 *
 * `notifyDone` se dispara con `setTimeout(0)` tras `load` para dar margen a
 * los módulos ES, que se ejecutan después del evento.
 */
function consoleBridge(token: number): string {
  return `<script>
(function () {
  var TOKEN = ${token};
  function send(payload) { parent.postMessage(Object.assign({ __codequest: TOKEN }, payload), '*'); }
  function format(args) {
    return Array.prototype.map.call(args, function (value) {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value); } catch (e) { return String(value); }
    }).join(' ');
  }
  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    var original = console[level].bind(console);
    console[level] = function () {
      send({ type: 'console', level: level, text: format(arguments) });
      original.apply(null, arguments);
    };
  });
  window.addEventListener('error', function (event) {
    send({ type: 'error', text: event.message });
  });
  window.addEventListener('unhandledrejection', function (event) {
    send({ type: 'error', text: 'Promesa rechazada: ' + event.reason });
  });
  window.addEventListener('load', function () {
    setTimeout(function () { send({ type: 'done' }); }, 0);
  });
})();
</script>`;
}

/**
 * Documento mínimo para lecciones que no traen `index.html`.
 *
 * Se referencian los `.css` y `.js` del workspace con etiquetas normales, para
 * que `assembleDocument` las sustituya por su contenido con el mismo camino de
 * siempre — sin una segunda vía de inyección que pudiera divergir.
 *
 * El orden importa: el `entry` declarado por la lección va el último, porque
 * suele ser el que consume a los demás.
 */
function synthesizeHtml(files: FileMap, entry?: string): string {
  const paths = Object.keys(files);
  const styles = paths.filter((path) => path.endsWith('.css'));

  const scripts = paths.filter((path) => /\.(js|mjs)$/.test(path));
  if (entry && scripts.includes(entry)) {
    scripts.splice(scripts.indexOf(entry), 1);
    scripts.push(entry);
  }

  return [
    '<!doctype html>',
    '<html lang="es">',
    '  <head>',
    '    <meta charset="utf-8" />',
    ...styles.map((path) => `    <link rel="stylesheet" href="./${path}" />`),
    '  </head>',
    '  <body>',
    ...scripts.map((path) => `    <script type="module" src="./${path}"></script>`),
    '  </body>',
    '</html>',
  ].join('\n');
}
