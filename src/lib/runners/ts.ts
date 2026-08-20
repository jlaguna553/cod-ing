import type { FileMap, LocalizedRuntimeSpec, RunResult, Runner } from './types';
import { OutputEmitter, RunnerBootError } from './types';
import { comoTsc, compilarTypeScript, configurarTypeScript } from './ts-compile';
import type { TsDiagnostic } from './ts-compile';
import { DomRunner } from './dom';

/**
 * TypeScript de verdad: se comprueban los tipos y luego se ejecuta (ADR-25).
 *
 * ## De dónde sale el compilador
 *
 * Del editor. Monaco trae su propio TypeScript para dibujar los subrayados
 * rojos, y expone su servicio de lenguaje. Cargar otro compilador serían ocho
 * megas más para dar la misma respuesta — y, peor, dos respuestas posibles: el
 * editor podría no decir nada mientras la comprobación de la lección falla,
 * que es la forma más desconcertante de suspender a alguien. **El error que
 * juzga la lección es el mismo que está subrayado en pantalla.**
 *
 * ## Qué pasa al ejecutar
 *
 * Primero se comprueban los tipos. Si hay errores, **no se ejecuta nada**: se
 * imprimen como los imprime `tsc` —archivo, línea, código y mensaje— y ahí
 * termina. Es lo que hace un proyecto real y es justo la lección: en
 * TypeScript el fallo ocurre antes de arrancar, no en producción a las tres de
 * la mañana.
 *
 * Si compila, el JavaScript emitido se ejecuta en el mismo iframe aislado que
 * usan las lecciones de JavaScript (`DomRunner`), con su consola y su espejo
 * del DOM. No se reimplementa nada de eso: se delega.
 */

export type { TsDiagnostic } from './ts-compile';

export class TsRunner implements Runner {
  readonly kind = 'ts' as const;

  private files: FileMap = {};
  private entry: string | null = null;
  private emitter = new OutputEmitter();
  private dom: DomRunner;
  private spec: LocalizedRuntimeSpec | null = null;
  private diagnostics: TsDiagnostic[] = [];

  constructor(private readonly mount: HTMLElement) {
    this.dom = new DomRunner(mount);
  }

  async boot(spec: LocalizedRuntimeSpec, files: FileMap, entry?: string): Promise<void> {
    this.files = { ...files };
    this.entry = entry ?? null;
    this.spec = spec;

    this.emitter.emit('system', 'Preparando TypeScript…\n');

    try {
      await configurarTypeScript();
    } catch (cause) {
      throw new RunnerBootError('No se pudo preparar el compilador de TypeScript.', cause);
    }

    // La salida del código compilado sale por el mismo sitio que la de una
    // lección de JavaScript: se reenvía tal cual.
    this.dom.onOutput((chunk) => this.emitter.emit(chunk.stream, chunk.data));
    await this.dom.boot(spec, {}, 'main.js');

    this.emitter.emit('system', 'TypeScript listo.\n');
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files[path] = content;
  }

  async run(): Promise<RunResult> {
    const startedAt = Date.now();
    const entrada = this.entry ?? Object.keys(this.files).find((f) => f.endsWith('.ts'));

    if (!entrada || this.files[entrada] === undefined) {
      return this.fallo('No hay ningún archivo de TypeScript que ejecutar.', startedAt);
    }

    const { diagnostics, javascript } = await this.compilar(entrada);
    this.diagnostics = diagnostics;

    if (diagnostics.length > 0) {
      /*
       * Se imprime como `tsc`, con el código del error incluido.
       *
       * `TS2322` no es ruido: es lo que se pega en un buscador cuando el
       * mensaje no basta, y aprender a leerlo forma parte de usar el lenguaje.
       */
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

    /*
     * Compila: se ejecuta el JavaScript emitido.
     *
     * Los archivos que no son TypeScript —un `index.html`, una hoja de
     * estilos— viajan tal cual: una lección puede enseñar tipos y pintar algo.
     */
    const paraEjecutar: FileMap = {};
    for (const [ruta, contenido] of Object.entries(this.files)) {
      if (!ruta.endsWith('.ts')) paraEjecutar[ruta] = contenido;
    }
    paraEjecutar['main.js'] = javascript;

    await this.dom.boot(this.spec!, paraEjecutar, 'main.js');
    const resultado = await this.dom.run();

    return { ...resultado, artifacts: { ...resultado.artifacts, diagnostics: [] } };
  }

  /** Los diagnósticos que el editor está enseñando, para las reglas. */
  getDiagnostics(): TsDiagnostic[] {
    return this.diagnostics;
  }

  getDocument(): Document | null {
    return this.dom.getDocument();
  }

  /** Comprueba los tipos y emite el JavaScript de la entrada. */
  private async compilar(entrada: string) {
    const { diagnostics, javascript } = await compilarTypeScript(this.files, [entrada]);
    return { diagnostics, javascript: javascript[entrada] ?? '' };
  }

  private fallo(mensaje: string, startedAt: number): RunResult {
    this.emitter.emit('stderr', `${mensaje}\n`);
    return { exitCode: 1, stdout: '', stderr: mensaje, durationMs: Date.now() - startedAt };
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
