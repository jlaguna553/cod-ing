import type { FileMap } from './types';
import { getMonaco } from './monaco-bridge';

/**
 * El compilador de TypeScript que ya está cargado: el del editor (ADR-25).
 *
 * Monaco trae su propio TypeScript para dibujar los subrayados rojos y expone
 * su servicio de lenguaje. Cargar otro serían ocho megas más para dar la misma
 * respuesta — y, peor, dos respuestas posibles: el editor podría no decir nada
 * mientras la comprobación de la lección falla, que es la forma más
 * desconcertante de suspender a alguien. **El error que juzga la lección es el
 * mismo que está subrayado en pantalla.**
 *
 * Vive aparte del runner porque lo usan dos: el de TypeScript y el de Nest,
 * que necesita lo mismo con decoradores y módulos CommonJS. Las sutilezas de
 * abajo —reutilizar los modelos por URI, sincronizarlos todos con el worker—
 * costaron encontrarlas una vez; tenerlas dos veces era garantizar que se
 * arreglaran en una sola.
 */

/** Diagnóstico de TypeScript, en lo que necesita la lección. */
export interface TsDiagnostic {
  code: number;
  message: string;
  line: number;
  file: string;
}

interface RawDiagnostic {
  code: number;
  start?: number;
  messageText: string | { messageText: string };
}

interface TsWorker {
  getSyntacticDiagnostics(fileName: string): Promise<RawDiagnostic[]>;
  getSemanticDiagnostics(fileName: string): Promise<RawDiagnostic[]>;
  getEmitOutput(fileName: string): Promise<{ outputFiles: Array<{ name: string; text: string }> }>;
}

export interface OpcionesTypeScript {
  /** `@Controller()` y compañía. Los necesita Nest; nadie más. */
  decoradores?: boolean;
  /**
   * `none` deja el JavaScript emitido en el ámbito global, listo para un
   * `<script>`. `commonjs` lo convierte en `require`/`exports`, que es lo que
   * resuelve el prelude de Node.
   */
  modulos?: 'none' | 'commonjs';
  /**
   * Declaraciones de módulos que no existen en disco —`@nestjs/common`—, para
   * que el `import` de la lección se resuelva y tipe.
   */
  librerias?: Array<{ ruta: string; contenido: string }>;
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
export async function configurarTypeScript(opciones: OpcionesTypeScript = {}) {
  const monaco = await getMonaco();
  const ts = monaco.languages.typescript;

  ts.typescriptDefaults.setCompilerOptions({
    ...ts.typescriptDefaults.getCompilerOptions(),
    strict: true,
    /*
     * Salvo esta, que es la que trae el `tsconfig.json` que genera el propio
     * Nest: las propiedades de un DTO las rellena el framework al recibir la
     * petición, así que exigir que estén inicializadas en el constructor
     * suspendería al alumno por escribir exactamente lo que hay que escribir.
     */
    strictPropertyInitialization: !opciones.decoradores,
    experimentalDecorators: opciones.decoradores === true,
    emitDecoratorMetadata: opciones.decoradores === true,
    target: ts.ScriptTarget.ES2020,
    module: opciones.modulos === 'commonjs' ? ts.ModuleKind.CommonJS : ts.ModuleKind.None,
    lib: ['es2020', 'dom'],
    noEmitOnError: false,
  });

  for (const libreria of opciones.librerias ?? []) {
    ts.typescriptDefaults.addExtraLib(libreria.contenido, libreria.ruta);
  }
}

/**
 * Comprueba los tipos y emite el JavaScript de los archivos pedidos.
 *
 * Los modelos se **reutilizan** por su URI, que es la misma que usa el editor
 * (`path={activeFile}`). Crear uno propio dejaba dos copias del mismo archivo
 * en el ámbito global de TypeScript: cada función declarada dos veces, y el
 * compilador contestando «No overload matches this call» a una función sin
 * sobrecargas.
 *
 * Los archivos que el editor no tiene abiertos sí se crean aquí: si no, una
 * lección de dos archivos se comprobaría a medias y el tipo importado del otro
 * sería `any`.
 */
export async function compilarTypeScript(
  archivos: FileMap,
  objetivos: string[],
): Promise<{ diagnostics: TsDiagnostic[]; javascript: Record<string, string> }> {
  const monaco = await getMonaco();

  for (const [ruta, contenido] of Object.entries(archivos)) {
    if (!ruta.endsWith('.ts')) continue;

    const uri = monaco.Uri.parse(ruta);
    const modelo = monaco.editor.getModel(uri);
    if (modelo) modelo.setValue(contenido);
    else monaco.editor.createModel(contenido, 'typescript', uri);
  }

  /*
   * Se le pasan TODAS las URIs, no solo las que interesan.
   *
   * Esa llamada es la que sincroniza los modelos con el worker: pedir solo una
   * dejaría el resto con el contenido de la ejecución anterior, y los errores
   * saldrían con números de línea de un archivo que ya no existe. Se vio en el
   * primer intento: `main.ts(5)` en un archivo de cuatro líneas.
   */
  const uris = Object.keys(archivos)
    .filter((ruta) => ruta.endsWith('.ts'))
    .map((ruta) => monaco.Uri.parse(ruta));

  const obtener = await monaco.languages.typescript.getTypeScriptWorker();
  const worker = (await obtener(...uris)) as unknown as TsWorker;

  const diagnostics: TsDiagnostic[] = [];
  const javascript: Record<string, string> = {};

  for (const objetivo of objetivos) {
    if (archivos[objetivo] === undefined) continue;

    const uri = monaco.Uri.parse(objetivo);
    const ruta = uri.toString();
    const crudos = [
      ...(await worker.getSyntacticDiagnostics(ruta)),
      ...(await worker.getSemanticDiagnostics(ruta)),
    ];

    const modelo = monaco.editor.getModel(uri);
    for (const d of crudos) {
      diagnostics.push({
        code: d.code,
        message: typeof d.messageText === 'string' ? d.messageText : d.messageText.messageText,
        line: modelo && d.start !== undefined ? modelo.getPositionAt(d.start).lineNumber : 0,
        file: objetivo,
      });
    }
  }

  // Con errores no se emite nada: es lo que hace un proyecto real, y es justo
  // la lección — en TypeScript el fallo ocurre antes de arrancar.
  if (diagnostics.length > 0) return { diagnostics, javascript };

  for (const objetivo of objetivos) {
    if (archivos[objetivo] === undefined) continue;
    const salida = await worker.getEmitOutput(monaco.Uri.parse(objetivo).toString());
    javascript[objetivo] = salida.outputFiles.find((f) => f.name.endsWith('.js'))?.text ?? '';
  }

  return { diagnostics, javascript };
}

/** Formatea los diagnósticos como los imprime `tsc`, con el código incluido. */
export function comoTsc(diagnostics: TsDiagnostic[]): string {
  return diagnostics
    .map((d) => `${d.file}(${d.line}): error TS${d.code}: ${d.message}`)
    .join('\n');
}
