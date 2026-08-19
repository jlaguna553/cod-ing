import type { FileMap, LocalizedRuntimeSpec, RunResult, Runner } from './types';
import { OutputEmitter } from './types';
import { DomRunner } from './dom';
import { NODE_PRELUDE } from './node-prelude';

/**
 * Node simulado en el navegador (ADR-26).
 *
 * **JavaScript es JavaScript**: el bucle de eventos, las promesas, los
 * closures y `require` se comportan igual aquí que en Node porque el motor es
 * el mismo. Lo que no hay son las APIs del sistema, y de esas se implementa un
 * subconjunto honesto en `node-prelude.ts`: módulos CommonJS, `path`,
 * `events`, un `fs` en memoria, `http` con peticiones deterministas y
 * `process`.
 *
 * Node de verdad en el navegador existe —WebContainers— y su licencia es el
 * bloqueo declarado en el ADR-07. La otra alternativa, un runtime remoto,
 * cuesta dinero y latencia en el bucle donde más se itera.
 *
 * La ejecución se delega en el runner de DOM: mismo iframe aislado, misma
 * consola, mismo puente. Lo único propio es el prelude que va delante.
 */
export class NodeRunner implements Runner {
  readonly kind = 'node' as const;

  /** Marca del último trozo de salida, para saber cuándo se quedó en silencio. */
  private ultimaSalida = 0;
  private files: FileMap = {};
  private entry: string | null = null;
  private spec: LocalizedRuntimeSpec | null = null;
  private emitter = new OutputEmitter();
  private dom: DomRunner;

  constructor(mount: HTMLElement) {
    this.dom = new DomRunner(mount);
  }

  async boot(spec: LocalizedRuntimeSpec, files: FileMap, entry?: string): Promise<void> {
    this.files = { ...files };
    this.entry = entry ?? null;
    this.spec = spec;

    this.dom.onOutput((chunk) => {
      this.ultimaSalida = Date.now();
      this.emitter.emit(chunk.stream, chunk.data);
    });
    await this.dom.boot(spec, {}, 'main.js');
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files[path] = content;
  }

  async run(): Promise<RunResult> {
    const entrada = this.entry ?? 'main.js';
    const codigo = this.files[entrada] ?? '';

    if (codigo.trim() === '') {
      const mensaje = 'No hay código que ejecutar.';
      this.emitter.emit('stderr', `${mensaje}\n`);
      return { exitCode: 1, stdout: '', stderr: mensaje, durationMs: 0 };
    }

    /*
     * El reloj del silencio se pone a cero AQUÍ.
     *
     * Sin esto, la marca conservaba la salida de la ejecución anterior: en la
     * segunda ejecución ya llevaba de sobra los 250 ms, así que la espera
     * devolvía de inmediato y la evaluación juzgaba antes de que llegara nada.
     * Fallaba solo a veces — el peor de los fallos.
     */
    this.ultimaSalida = Date.now();

    await this.dom.boot(this.spec!, { 'main.js': this.montar(entrada, codigo) }, 'main.js');
    const resultado = await this.dom.run();

    await this.esperarASilencio();
    return resultado;
  }

  /**
   * Espera a que deje de salir texto antes de dar la ejecución por terminada.
   *
   * `node main.js` no termina cuando acaba la última línea del archivo: sigue
   * vivo mientras queden temporizadores o promesas pendientes. Aquí la
   * ejecución se resolvía al cargar el documento, así que una lección con un
   * `setTimeout` de 10 ms se evaluaba **antes** de que su salida existiera:
   * las comprobaciones fallaban sobre código correcto y volvían a pasar al
   * pulsar «Evaluar» por segunda vez, que es la peor forma de fallar.
   *
   * Se espera al silencio y no un tiempo fijo: lo rápido no paga el retraso de
   * lo lento, y lo lento no se corta a mitad de frase.
   */
  private async esperarASilencio(silencioMs = 250, techoMs = 3000): Promise<void> {
    const limite = Date.now() + techoMs;

    for (;;) {
      const quieto = Date.now() - this.ultimaSalida;
      if (quieto >= silencioMs || Date.now() > limite) return;
      await new Promise((listo) => setTimeout(listo, 60));
    }
  }

  /**
   * Compone el archivo que se ejecuta: entorno, prelude y código del usuario.
   *
   * Los archivos de la lección viajan como datos —no como `<script>`— porque
   * son el sistema de archivos que verá `fs` y los módulos que resolverá
   * `require`. Cargarlos como scripts los ejecutaría todos a la vez, que es
   * justo lo contrario del modelo de módulos que la lección enseña.
   */
  private montar(entrada: string, codigo: string): string {
    const otros: FileMap = {};
    for (const [ruta, contenido] of Object.entries(this.files)) {
      if (ruta !== entrada) otros[ruta] = contenido;
    }

    const peticiones = this.spec?.requests ?? [];

    return [
      `window.__ARCHIVOS__ = ${JSON.stringify(otros)};`,
      `window.__PETICIONES__ = ${JSON.stringify(peticiones)};`,
      NODE_PRELUDE,
      '\n/* ── código de la lección ─────────────────────────────────── */\n',
      codigo,
      /*
       * La cola de `nextTick` se vacía al terminar el código síncrono, que es
       * cuando la vacía Node. Sin esta línea, `nextTick` tendría que apoyarse
       * en una promesa y quedaría DETRÁS de las promesas del usuario — el
       * orden contrario al que enseña la lección.
       */
      '\n;window.__drenarTicks__ && window.__drenarTicks__();',
    ].join('\n');
  }

  getDocument(): Document | null {
    return this.dom.getDocument();
  }

  onOutput(cb: Parameters<OutputEmitter['on']>[0]) {
    return this.emitter.on(cb);
  }

  async reset(): Promise<void> {
    await this.dom.reset();
  }

  dispose(): void {
    this.dom.dispose();
    this.emitter.clear();
  }
}
