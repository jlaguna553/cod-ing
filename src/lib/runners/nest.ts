import type { FileMap, LocalizedRuntimeSpec, RunResult, Runner } from './types';
import { OutputEmitter, RunnerBootError } from './types';
import { DomRunner } from './dom';
import { NODE_PRELUDE } from './node-prelude';
import { NEST_PRELUDE, NEST_TIPOS } from './nest-prelude';
import { comoTsc, compilarTypeScript, configurarTypeScript } from './ts-compile';
import type { TsDiagnostic } from './ts-compile';

/**
 * NestJS sobre el Node simulado y el compilador del editor (ADR-28).
 *
 * Un proyecto de Nest es TypeScript con decoradores repartido en varios
 * archivos, así que aquí pasan dos cosas y en este orden:
 *
 * 1. **Se compila todo**, no solo la entrada. Un fallo de tipos en el servicio
 *    tiene que salir aunque el que se ejecute sea `main.ts`, y el JavaScript
 *    emitido va a CommonJS para que lo resuelva el `require` del prelude de
 *    Node — el mismo, con la misma caché.
 * 2. **Se ejecuta** con los dos preludes por delante: el de Node, que pone
 *    `require` y los módulos del núcleo, y el de Nest, que registra
 *    `@nestjs/common` entre ellos y trae el contenedor y el enrutado.
 *
 * Si los tipos fallan no se ejecuta nada y se imprime como `tsc`. Es lo que
 * hace un proyecto real, y en Nest tiene un valor añadido: media configuración
 * del framework —qué hay en `providers`, qué recibe un constructor— se declara
 * con tipos.
 */
export class NestRunner implements Runner {
  readonly kind = 'nest' as const;

  private ultimaSalida = 0;
  private files: FileMap = {};
  private entry: string | null = null;
  private spec: LocalizedRuntimeSpec | null = null;
  private emitter = new OutputEmitter();
  private dom: DomRunner;
  private diagnostics: TsDiagnostic[] = [];

  constructor(mount: HTMLElement) {
    this.dom = new DomRunner(mount);
  }

  async boot(spec: LocalizedRuntimeSpec, files: FileMap, entry?: string): Promise<void> {
    this.files = { ...files };
    this.entry = entry ?? null;
    this.spec = spec;

    this.emitter.emit('system', 'Preparando Nest…\n');

    try {
      await configurarTypeScript({
        decoradores: true,
        modulos: 'commonjs',
        librerias: [{ ruta: 'file:///node_modules/@types/nest/index.d.ts', contenido: NEST_TIPOS }],
      });
    } catch (cause) {
      throw new RunnerBootError('No se pudo preparar el compilador de TypeScript.', cause);
    }

    this.dom.onOutput((chunk) => {
      this.ultimaSalida = Date.now();
      this.emitter.emit(chunk.stream, chunk.data);
    });
    await this.dom.boot(spec, {}, 'main.js');

    this.emitter.emit('system', 'Nest listo.\n');
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files[path] = content;
  }

  async run(): Promise<RunResult> {
    const startedAt = Date.now();
    const entrada = this.entry ?? Object.keys(this.files).find((f) => f.endsWith('.ts'));

    if (!entrada || this.files[entrada] === undefined) {
      const mensaje = 'No hay ningún archivo de TypeScript que ejecutar.';
      this.emitter.emit('stderr', `${mensaje}\n`);
      return { exitCode: 1, stdout: '', stderr: mensaje, durationMs: Date.now() - startedAt };
    }

    const objetivos = Object.keys(this.files).filter((ruta) => ruta.endsWith('.ts'));
    const { diagnostics, javascript } = await compilarTypeScript(this.files, objetivos);
    this.diagnostics = diagnostics;

    if (diagnostics.length > 0) {
      const texto = comoTsc(diagnostics);
      this.emitter.emit('stderr', `${texto}\n`);
      this.emitter.emit(
        'system',
        `\nNo se ejecuta nada: ${diagnostics.length} error(es) de tipos.\n`,
      );

      return {
        exitCode: 2,
        stdout: '',
        stderr: texto,
        durationMs: Date.now() - startedAt,
        artifacts: { diagnostics },
      };
    }

    this.ultimaSalida = Date.now();

    await this.dom.boot(this.spec!, { 'main.js': this.montar(entrada, javascript) }, 'main.js');
    const resultado = await this.dom.run();

    await this.esperarASilencio();
    return { ...resultado, artifacts: { ...resultado.artifacts, diagnostics: [] } };
  }

  /** Los diagnósticos que el editor está enseñando, para las reglas. */
  getDiagnostics(): TsDiagnostic[] {
    return this.diagnostics;
  }

  /**
   * Compone lo que se ejecuta: archivos como datos, preludes y la entrada.
   *
   * Los módulos compilados viajan con extensión `.js` porque es como los busca
   * el `require` del prelude: `require('./usuarios.service')` prueba la ruta
   * tal cual, luego `.js`, luego `/index.js`. Así el import que escribe el
   * alumno —sin extensión, como en cualquier proyecto— se resuelve solo.
   */
  private montar(entrada: string, javascript: Record<string, string>): string {
    const otros: FileMap = {};

    for (const [ruta, contenido] of Object.entries(this.files)) {
      if (!ruta.endsWith('.ts')) otros[ruta] = contenido;
    }
    for (const [ruta, emitido] of Object.entries(javascript)) {
      if (ruta !== entrada) otros[ruta.replace(/\.ts$/, '.js')] = emitido;
    }

    const peticiones = this.spec?.requests ?? [];

    return [
      `window.__ARCHIVOS__ = ${JSON.stringify(otros)};`,
      `window.__PETICIONES__ = ${JSON.stringify(peticiones)};`,
      NODE_PRELUDE,
      NEST_PRELUDE,
      '\n/* ── código de la lección ─────────────────────────────────── */\n',
      javascript[entrada] ?? '',
      '\n;window.__drenarTicks__ && window.__drenarTicks__();',
    ].join('\n');
  }

  /**
   * Espera a que deje de salir texto antes de dar la ejecución por terminada.
   *
   * Nest arranca con promesas —`await NestFactory.create(...)`— y las
   * peticiones se atienden encadenadas, así que la última línea llega varios
   * microtareas después de que el documento termine de cargar. Sin esta
   * espera, la evaluación juzgaba una consola todavía vacía.
   */
  private async esperarASilencio(silencioMs = 250, techoMs = 3000): Promise<void> {
    const limite = Date.now() + techoMs;

    for (;;) {
      const quieto = Date.now() - this.ultimaSalida;
      if (quieto >= silencioMs || Date.now() > limite) return;
      await new Promise((listo) => setTimeout(listo, 60));
    }
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
