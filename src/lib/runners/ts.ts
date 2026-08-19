import type { FileMap, LocalizedRuntimeSpec, RunResult, Runner } from './types';
import { OutputEmitter, RunnerBootError } from './types';
import { getMonaco } from './monaco-bridge';
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

/** Diagnóstico de TypeScript, en lo que necesita la lección. */
export interface TsDiagnostic {
  code: number;
  message: string;
  line: number;
  file: string;
}

/** Forma mínima del worker de TypeScript de Monaco. */
interface TsWorker {
  getSyntacticDiagnostics(fileName: string): Promise<RawDiagnostic[]>;
  getSemanticDiagnostics(fileName: string): Promise<RawDiagnostic[]>;
  getEmitOutput(fileName: string): Promise<{ outputFiles: Array<{ name: string; text: string }> }>;
}

interface RawDiagnostic {
  code: number;
  start?: number;
  messageText: string | { messageText: string };
}

/**
 * Pone el compilador en modo estricto.
 *
 * Monaco arranca su TypeScript **sin `strict`**, y eso no es un matiz: sin
 * `strictNullChecks` el estrechamiento sobre un campo booleano literal deja de
 * funcionar, y `if (!resultado.ok) resultado.error` —el patrón `Resultado<T>`
 * de manual— falla con «Property 'error' does not exist». Se descubrió con la
 * solución de una lección en la mano: la respuesta correcta no compilaba.
 *
 * Y es además lo que hay que enseñar: `strict: true` es el modo por defecto de
 * cualquier proyecto creado hoy, y la mitad de lo que hace útil al lenguaje
 * vive dentro de esa bandera.
 */
function configurar(monaco: Awaited<ReturnType<typeof getMonaco>>) {
  const ts = monaco.languages.typescript;

  ts.typescriptDefaults.setCompilerOptions({
    ...ts.typescriptDefaults.getCompilerOptions(),
    strict: true,
    target: ts.ScriptTarget.ES2020,
    // Sin módulos: el JavaScript emitido se ejecuta en un `<script>` normal,
    // y un `import` ahí sería un error en tiempo de ejecución.
    module: ts.ModuleKind.None,
    lib: ['es2020', 'dom'],
    noEmitOnError: false,
  });
}

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
      const monaco = await getMonaco();
      configurar(monaco);
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
      const texto = diagnostics
        .map((d) => `${d.file}(${d.line}): error TS${d.code}: ${d.message}`)
        .join('\n');

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

  /**
   * Pide al servicio de lenguaje que revise y emita.
   *
   * Los modelos se **reutilizan** por su URI, que es la misma que usa el
   * editor (`path={activeFile}`). Crear uno propio dejaba dos copias del
   * mismo archivo en el ámbito global de TypeScript: cada función declarada
   * dos veces, y el compilador contestando «No overload matches this call» a
   * una función sin sobrecargas.
   *
   * Los archivos que el editor no tiene abiertos sí se crean aquí: si no, una
   * lección de dos archivos se comprobaría a medias y el tipo importado del
   * otro sería `any`.
   */
  private async compilar(entrada: string) {
    const monaco = await getMonaco();

    for (const [ruta, contenido] of Object.entries(this.files)) {
      if (!ruta.endsWith('.ts')) continue;

      const uri = monaco.Uri.parse(ruta);
      const modelo = monaco.editor.getModel(uri);
      if (modelo) modelo.setValue(contenido);
      else monaco.editor.createModel(contenido, 'typescript', uri);
    }

    const uriEntrada = monaco.Uri.parse(entrada);
    const obtener = await monaco.languages.typescript.getTypeScriptWorker();

    /*
     * Se le pasan TODAS las URIs, no solo la de entrada.
     *
     * Esa llamada es la que sincroniza los modelos con el worker: pedir solo
     * la entrada dejaría el resto con el contenido de la ejecución anterior,
     * y los errores saldrían con números de línea de un archivo que ya no
     * existe. Se vio en el primer intento: `main.ts(5)` en un archivo de
     * cuatro líneas.
     */
    const uris = Object.keys(this.files)
      .filter((ruta) => ruta.endsWith('.ts'))
      .map((ruta) => monaco.Uri.parse(ruta));

    const worker = (await obtener(...uris, uriEntrada)) as unknown as TsWorker;

    const ruta = uriEntrada.toString();
    const crudos = [
      ...(await worker.getSyntacticDiagnostics(ruta)),
      ...(await worker.getSemanticDiagnostics(ruta)),
    ];

    const modelo = monaco.editor.getModel(uriEntrada);
    const diagnostics: TsDiagnostic[] = crudos.map((d) => ({
      code: d.code,
      message: typeof d.messageText === 'string' ? d.messageText : d.messageText.messageText,
      line: modelo && d.start !== undefined ? modelo.getPositionAt(d.start).lineNumber : 0,
      file: entrada,
    }));

    if (diagnostics.length > 0) return { diagnostics, javascript: '' };

    const salida = await worker.getEmitOutput(ruta);
    const javascript = salida.outputFiles.find((f) => f.name.endsWith('.js'))?.text ?? '';

    return { diagnostics, javascript };
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
