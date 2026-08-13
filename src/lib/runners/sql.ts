import type { FileMap, LocalizedRuntimeSpec, RunResult, Runner } from './types';
import { OutputEmitter, RunnerBootError } from './types';

/**
 * Postgres de verdad, dentro del navegador (ADR-11).
 *
 * No es un simulador ni un subconjunto: es PostgreSQL compilado a WebAssembly.
 * Los tipos, los mensajes de error, `NULL`, las funciones de ventana y el
 * planificador son los mismos que en producción. Un `GROUP BY` mal escrito
 * falla con el mismo texto que fallaría en un servidor real, y ese texto es
 * parte de lo que hay que aprender a leer.
 *
 * ## Por qué en el navegador y no en el servidor
 *
 * Ejecutar SQL del usuario en el servidor obligaría a aislar cada sesión —una
 * base efímera por petición— y aun así pagaría un viaje de red por cada
 * ejecución, justo en el bucle en el que más se itera. Aquí no hay servidor
 * que atacar: la base vive y muere en la pestaña.
 *
 * ## Por qué se carga a mano
 *
 * `import('@electric-sql/pglite')` a secas **falla** con este bundler:
 * `m.instantiateWasm is not a function`. El paquete trae su propio grafo de
 * chunks y el reempaquetado le rompe la interoperabilidad del namespace, así
 * que el módulo se pide tal cual, desde `/pglite/`, con un `import()` que el
 * bundler no puede reescribir porque no lo ve. Los archivos los copia
 * `scripts/copy-pglite.ts` desde `node_modules` en cada build: se sirven de
 * nuestro propio origen, sin CDN de terceros y con la versión clavada a la
 * del `package.json`.
 */

/** Fila de resultados: nombre de columna → valor. */
export type SqlRow = Record<string, unknown>;

export interface SqlResult {
  columns: string[];
  rows: SqlRow[];
  rowCount: number;
  /** Comando ejecutado (`SELECT`, `INSERT`…), tal como lo reporta Postgres. */
  command?: string;
}

interface PGliteLike {
  exec(query: string): Promise<Array<{ rows: SqlRow[]; fields: Array<{ name: string }>; affectedRows?: number }>>;
  close(): Promise<void>;
}

const MODULE_URL = '/pglite/index.js';

/*
 * `new Function` en vez de `import()` literal: es la única forma de que el
 * bundler no toque el especificador. Con `import('/pglite/index.js')` intenta
 * resolverlo en build y falla.
 */
const bareImport = new Function('url', 'return import(url)') as (
  url: string,
) => Promise<{ PGlite: new (options?: unknown) => PGliteLike }>;

export class SqlRunner implements Runner {
  readonly kind = 'sql' as const;

  private db: PGliteLike | null = null;
  private files: FileMap = {};
  private entry: string | null = null;
  private emitter = new OutputEmitter();
  private lastResult: SqlResult | null = null;

  async boot(spec: LocalizedRuntimeSpec, files: FileMap, entry?: string): Promise<void> {
    this.files = { ...files };
    this.entry = entry ?? null;

    this.emitter.emit('system', 'Arrancando PostgreSQL…\n');

    try {
      const { PGlite } = await bareImport(MODULE_URL);
      this.db = new PGlite();
    } catch (cause) {
      throw new RunnerBootError(
        'No se pudo arrancar PostgreSQL en el navegador.',
        cause,
      );
    }

    await this.seed();
    this.emitter.emit('system', 'PostgreSQL listo.\n');
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files[path] = content;
  }

  /**
   * Ejecuta la consulta del usuario y deshace lo que haya tocado.
   *
   * El `ROLLBACK` no es tacañería: sin él, una lección de `INSERT` duplicaría
   * filas en la segunda ejecución y el resultado dependería de cuántas veces
   * hubieras pulsado «Ejecutar». Con la transacción, cada ejecución parte
   * exactamente del mismo estado — y eso es lo que permite que la evaluación
   * signifique algo.
   */
  async run(command?: string): Promise<RunResult> {
    const startedAt = Date.now();
    const sql = (command ?? this.files[this.entry ?? ''] ?? '').trim();

    if (!this.db) {
      return this.fail('La base de datos no está lista.', startedAt);
    }
    if (sql === '') {
      return this.fail('No hay ninguna consulta que ejecutar.', startedAt);
    }

    await this.db.exec('BEGIN');
    try {
      const batches = await this.db.exec(sql);

      // De un script con varias sentencias interesa la última: es la que el
      // usuario está mirando, y la que la lección comprueba.
      const last = batches.at(-1);
      const result: SqlResult = {
        columns: last?.fields.map((field) => field.name) ?? [],
        rows: last?.rows ?? [],
        rowCount: last?.rows.length ?? last?.affectedRows ?? 0,
      };
      this.lastResult = result;

      const rendered = renderTable(result);
      this.emitter.emit('stdout', `${rendered}\n`);

      return {
        exitCode: 0,
        stdout: rendered,
        stderr: '',
        durationMs: Date.now() - startedAt,
        artifacts: { sql: result },
      };
    } catch (cause) {
      /*
       * El mensaje de Postgres se enseña tal cual. «column "nombre" does not
       * exist» dice exactamente qué pasa y en qué columna; reescribirlo en
       * palabras nuestras le quitaría al usuario la práctica de leer el error
       * que se va a encontrar en su trabajo.
       */
      const message = cause instanceof Error ? cause.message : String(cause);
      this.lastResult = null;
      this.emitter.emit('stderr', `${message}\n`);
      return {
        exitCode: 1,
        stdout: '',
        stderr: message,
        durationMs: Date.now() - startedAt,
        artifacts: { sql: null },
      };
    } finally {
      await this.db.exec('ROLLBACK');
    }
  }

  onOutput(cb: Parameters<OutputEmitter['on']>[0]) {
    return this.emitter.on(cb);
  }

  async reset(): Promise<void> {
    this.lastResult = null;
    await this.seed();
  }

  dispose(): void {
    this.emitter.clear();
    void this.db?.close();
    this.db = null;
  }

  /** Último resultado, para el evaluador y para la rejilla. */
  getSqlResult(): SqlResult | null {
    return this.lastResult;
  }

  /**
   * Aplica los `.sql` que no son la entrada, en orden de ruta.
   *
   * Convención en lugar de un campo nuevo en el schema: el archivo de entrada
   * es la consulta del usuario y todo lo demás es el esquema y los datos de
   * partida. Una lección se monta escribiendo dos archivos, sin tocar código.
   */
  private async seed(): Promise<void> {
    if (!this.db) return;

    const seeds = Object.keys(this.files)
      .filter((path) => path !== this.entry && path.endsWith('.sql'))
      .sort();

    for (const path of seeds) {
      try {
        await this.db.exec(this.files[path]);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        // Un seed roto es un fallo de la lección, no del usuario: se dice.
        throw new RunnerBootError(`El esquema inicial (${path}) falló: ${message}`, cause);
      }
    }
  }

  private fail(message: string, startedAt: number): RunResult {
    this.emitter.emit('stderr', `${message}\n`);
    return {
      exitCode: 1,
      stdout: '',
      stderr: message,
      durationMs: Date.now() - startedAt,
      artifacts: { sql: null },
    };
  }
}

/** Render de texto para la consola. La rejilla es otra cosa; esto es el log. */
export function renderTable(result: SqlResult): string {
  if (result.columns.length === 0) {
    return `${result.rowCount} fila(s) afectadas`;
  }

  const header = result.columns;
  const body = result.rows.map((row) => header.map((column) => format(row[column])));
  const widths = header.map((column, index) =>
    Math.max(column.length, ...body.map((cells) => cells[index].length), 3),
  );

  const line = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join(' | ');

  return [
    line(header),
    widths.map((width) => '-'.repeat(width)).join('-+-'),
    ...body.map(line),
    `(${result.rows.length} fila${result.rows.length === 1 ? '' : 's'})`,
  ].join('\n');
}

/** `NULL` se muestra como `NULL`, no como vacío: la diferencia es el tema de media lección. */
export function format(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
