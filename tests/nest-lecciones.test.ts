import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LessonSchema } from '@/lib/content/lesson.schema';
import { localize } from '@/lib/content/localize';
import type { Lesson } from '@/lib/content/types';
import { emptyContext, evaluateRule } from '@/lib/engine';
import { NODE_PRELUDE } from '@/lib/runners/node-prelude';
import { NEST_PRELUDE } from '@/lib/runners/nest-prelude';

/**
 * Las lecciones de Nest, resueltas y ejecutadas de verdad.
 *
 * Corrigen por salida —`POST /usuarios -> 201 {...}`, el texto exacto de un
 * error del framework—, y eso es fácil de escribir mal: basta una coma de más
 * en el JSON esperado para que la respuesta correcta del alumno no pase. Aquí
 * se compila cada paso con **el compilador del editor** (el TypeScript que
 * Monaco lleva dentro), se ejecuta con los mismos dos preludes que el runner y
 * se pasan sus reglas por el motor de evaluación de verdad.
 *
 * Lo que no se comprueba aquí es la comprobación de tipos, que en producción
 * corre en el worker de Monaco: `transpileModule` solo traduce. De eso se
 * encarga `e2e/nest.spec.ts`.
 */

const SERVICIOS = path.resolve(
  import.meta.dirname,
  '../node_modules/monaco-editor/esm/vs/languages/features/typescript/lib/typescriptServices.js',
);

const { typescript: ts } = (await import(SERVICIOS)) as {
  typescript: {
    ModuleKind: { CommonJS: number };
    ScriptTarget: { ES2020: number };
    transpileModule: (entrada: string, opciones: unknown) => { outputText: string };
  };
};

function compilar(codigo: string): string {
  return ts.transpileModule(codigo, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    },
  }).outputText;
}

function leccionesDeNest(): Lesson[] {
  const raiz = path.resolve(import.meta.dirname, '../content/lessons');
  const recorrer = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
      const completa = path.join(dir, entrada.name);
      if (entrada.isDirectory()) return recorrer(completa);
      return entrada.name.endsWith('.lesson.json') ? [completa] : [];
    });

  return recorrer(raiz)
    .map((archivo) => LessonSchema.parse(JSON.parse(readFileSync(archivo, 'utf8'))))
    .filter((leccion) => leccion.runtime.kind === 'nest')
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Monta el proyecto igual que `NestRunner` y devuelve lo que sale por consola. */
async function ejecutar(
  archivos: Record<string, string>,
  entrada: string,
  peticiones: Array<{ method: string; url: string; body?: string }>,
): Promise<string> {
  const salida: string[] = [];
  const otros: Record<string, string> = {};

  for (const [ruta, contenido] of Object.entries(archivos)) {
    if (ruta === entrada) continue;
    otros[ruta.endsWith('.ts') ? ruta.replace(/\.ts$/, '.js') : ruta] = ruta.endsWith('.ts')
      ? compilar(contenido)
      : contenido;
  }

  const global: Record<string, unknown> = {
    __ARCHIVOS__: otros,
    __PETICIONES__: peticiones,
    console: {
      log: (...args: unknown[]) => salida.push(args.map(String).join(' ')),
      error: (...args: unknown[]) => salida.push(args.map(String).join(' ')),
      warn: () => {},
      info: () => {},
    },
  };

  new Function('window', `with (window) { ${NODE_PRELUDE} ${NEST_PRELUDE} }`)(global);

  // Los módulos que carga `require` corren en su propio ámbito, donde `console`
  // es la de verdad; en el navegador se captura el iframe entero, aquí no.
  const original = globalThis.console.log;
  globalThis.console.log = (...args: unknown[]) => salida.push(args.map(String).join(' '));

  try {
    new Function('require', 'process', 'console', 'module', 'exports', compilar(archivos[entrada]))(
      global.require,
      global.process,
      global.console,
      { exports: {} },
      {},
    );
    await new Promise((listo) => setTimeout(listo, 20));
  } finally {
    globalThis.console.log = original;
  }

  return salida.join('\n');
}

for (const leccion of leccionesDeNest()) {
  const localizada = localize(leccion, 'es');
  const porId = new Map(localizada.rules.map((regla) => [regla.id, regla]));

  const archivos: Record<string, string> = Object.fromEntries(
    leccion.workspace.files.map((archivo) => [archivo.path, archivo.content]),
  );

  /*
   * Los pasos se acumulan, que es lo que hace el alumno: el paso 3 se resuelve
   * encima del 2, no sobre el archivo de partida.
   */
  for (const [indice, paso] of localizada.steps.entries()) {
    test(`⭐ ${leccion.id} · paso ${indice + 1} (${paso.id}): la solución cumple lo que promete`, async () => {
      assert.ok(paso.solution?.length, `el paso ${paso.id} no publica solución`);
      for (const archivo of paso.solution) archivos[archivo.path] = archivo.content;

      const stdout = await ejecutar(
        archivos,
        leccion.workspace.entry,
        leccion.runtime.requests as Array<{ method: string; url: string; body?: string }>,
      );

      const contexto = emptyContext({ hasRun: true, stdout, exitCode: 0, files: { ...archivos } });

      for (const id of paso.ruleIds) {
        const regla = porId.get(id);
        assert.ok(regla, `el paso ${paso.id} referencia una regla inexistente: ${id}`);

        const resultado = evaluateRule(regla as never, contexto);
        assert.ok(resultado, `la regla "${id}" quedó pendiente contra su propia solución`);
        assert.equal(
          resultado.passed,
          true,
          `[${leccion.id} · ${paso.id}] "${id}" falla contra su propia solución.\n` +
            `esperado: ${resultado.detail?.expected ?? '—'}\n--- salida ---\n${stdout}`,
        );
      }
    });
  }

  test(`⭐ ${leccion.id}: el proyecto de partida deja algo que hacer`, async () => {
    const partida: Record<string, string> = Object.fromEntries(
      leccion.workspace.files.map((archivo) => [archivo.path, archivo.content]),
    );

    const stdout = await ejecutar(
      partida,
      leccion.workspace.entry,
      leccion.runtime.requests as Array<{ method: string; url: string; body?: string }>,
    );
    const contexto = emptyContext({ hasRun: true, stdout, exitCode: 0, files: partida });

    const bloqueantes = localizada.rules.filter((regla) => regla.severity === 'error');
    const superadas = bloqueantes.filter((regla) => evaluateRule(regla as never, contexto)?.passed);

    assert.ok(
      superadas.length < bloqueantes.length,
      'el proyecto de partida ya pasa todas las comprobaciones: la lección no pide nada',
    );
  });
}
