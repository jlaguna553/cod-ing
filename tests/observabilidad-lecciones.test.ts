import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NODE_PRELUDE } from '@/lib/runners/node-prelude';
import { LessonSchema } from '@/lib/content/lesson.schema';

/**
 * Las lecciones de observabilidad, resueltas y comprobadas.
 *
 * Estas tres corrigen por **salida**: `"p95":950`, `"errores":3`,
 * `"requestId":"req-2"`. Una cifra mal calculada al escribir el contenido no
 * la detecta el validador de lecciones —el JSON es válido— y el alumno se
 * encuentra con que su respuesta correcta no pasa. Así que aquí se ejecuta la
 * solución publicada de cada paso contra el mismo runtime que usa el navegador
 * y se exige que cumpla exactamente las reglas de ese paso.
 */

const DIRECTORIO = path.resolve(import.meta.dirname, '../content/lessons/devops/observability');

function leer(id: string) {
  return LessonSchema.parse(
    JSON.parse(readFileSync(path.join(DIRECTORIO, `${id}.lesson.json`), 'utf8')),
  );
}

/** Ejecuta el workspace como lo hace el runner: entry en directo, resto en memoria. */
function ejecutar(
  archivos: Record<string, string>,
  entry: string,
  peticiones: { method: string; url: string }[],
): string {
  const salida: string[] = [];
  const otros = { ...archivos };
  delete otros[entry];

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

  new Function('window', `with (window) { ${NODE_PRELUDE} }`)(global);

  /*
   * Los módulos que carga `require` no ven la consola falsa: el prelude los
   * ejecuta en su propio ámbito, y ahí `console` es la de verdad. En el
   * navegador da igual —la salida del iframe se captura entera—, pero aquí
   * los logs de `log.js` se perdían por la consola del test y la salida
   * llegaba vacía. Se intercepta la real mientras dura la ejecución.
   */
  const original = globalThis.console.log;
  globalThis.console.log = (...args: unknown[]) => salida.push(args.map(String).join(' '));

  try {
    new Function('require', 'process', 'console', 'module', 'exports', archivos[entry])(
      global.require,
      global.process,
      global.console,
      { exports: {} },
      {},
    );
  } finally {
    globalThis.console.log = original;
  }

  return salida.join('\n');
}

/**
 * Recorre los pasos acumulando soluciones y comprueba las reglas de cada uno.
 *
 * Acumulando, porque es lo que hace el alumno: el paso 3 se resuelve encima
 * del 2, no sobre el archivo original.
 */
function comprobarLeccion(id: string) {
  const lesson = leer(id);
  const archivos: Record<string, string> = Object.fromEntries(
    lesson.workspace.files.map((f) => [f.path, f.content]),
  );
  const reglas = new Map(lesson.rules.map((rule) => [rule.id, rule]));

  lesson.steps.forEach((step, indice) => {
    for (const archivo of step.solution ?? []) archivos[archivo.path] = archivo.content;

    const salida = ejecutar(archivos, lesson.workspace.entry, lesson.runtime.requests);

    for (const ruleId of step.ruleIds) {
      const rule = reglas.get(ruleId);
      assert.ok(rule, `${id}: el paso ${indice + 1} apunta a una regla que no existe: ${ruleId}`);

      if (rule.kind === 'stdout-match' && rule.matches) {
        assert.match(
          salida,
          new RegExp(rule.matches),
          `${id} · paso ${indice + 1} · ${ruleId}\n--- salida ---\n${salida}`,
        );
      }

      if (rule.kind === 'regex-must') {
        assert.match(
          archivos[rule.file] ?? '',
          new RegExp(rule.pattern, 'm'),
          `${id} · paso ${indice + 1} · ${ruleId}: la solución no cumple su propia regla`,
        );
      }

      if (rule.kind === 'regex-forbid') {
        assert.doesNotMatch(
          archivos[rule.file] ?? '',
          new RegExp(rule.pattern, 'm'),
          `${id} · paso ${indice + 1} · ${ruleId}: la solución incumple una prohibición`,
        );
      }
    }
  });
}

test('⭐ obs-01: la solución de cada paso emite los logs que la lección exige', () => {
  comprobarLeccion('obs-01-logs-estructurados');
});

test('⭐ obs-02: el identificador aparece en las dos capas de la misma petición', () => {
  comprobarLeccion('obs-02-seguir-una-peticion');
});

test('⭐ obs-03: las cifras del enunciado son las que salen de verdad', () => {
  comprobarLeccion('obs-03-metricas-y-percentiles');
});

/*
 * Y la afirmación central de la lección 3, aparte: si la media y el p50 no se
 * separan, el ejercicio no enseña nada. Se comprueba sobre los datos que trae
 * la lección, no sobre unos inventados aquí.
 */
test('⭐ los datos de obs-03 tienen cola: la media dobla con creces a la mediana', () => {
  const lesson = leer('obs-03-metricas-y-percentiles');
  const fuente = lesson.workspace.files.find((f) => f.path === 'peticiones.js')!.content;
  const duraciones = [...fuente.matchAll(/ms: (\d+)/g)].map((m) => Number(m[1]));

  const media = duraciones.reduce((a, b) => a + b, 0) / duraciones.length;
  const ordenadas = [...duraciones].sort((a, b) => a - b);
  const p50 = ordenadas[Math.ceil(0.5 * ordenadas.length) - 1];

  assert.ok(media > p50 * 2, `media ${media} vs p50 ${p50}: sin cola, no hay lección`);
});
