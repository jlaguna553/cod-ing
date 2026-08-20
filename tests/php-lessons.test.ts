import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LessonSchema } from '@/lib/content/lesson.schema';
import { codigoDe, localize } from '@/lib/content/localize';
import type { Lesson } from '@/lib/content/types';
import { emptyContext, evaluateRule } from '@/lib/engine';
import { PHP_PRELUDE } from '@/lib/runners/php-prelude';

/**
 * Las lecciones de PHP, ejecutadas con el intérprete de verdad.
 *
 * Es el test que sostiene el ADR-20. El intérprete cubre **un subconjunto** de
 * PHP —sintaxis de la 5.x y una biblioteca estándar que se completa con el
 * prelude—, así que una lección puede estar impecable sobre el papel y no
 * ejecutarse: basta una expresión flecha o una función que no existe. Aquí se
 * ejecuta cada paso con el mismo motor que usará el navegador y se comprueban
 * sus reglas contra la salida real.
 *
 * Sin esto, el límite del subconjunto lo descubriría el usuario.
 */

const require = createRequire(import.meta.url);

interface PhpEngine {
  execute(code: string): Promise<unknown>;
  getStdout(): { on(event: 'data', cb: (data: string) => void): void };
}

function phpLessons(): Lesson[] {
  const root = path.resolve(import.meta.dirname, '../content/lessons');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : entry.name.endsWith('.lesson.json') ? [full] : [];
    });

  return walk(root)
    .map((file) => LessonSchema.parse(JSON.parse(readFileSync(file, 'utf8'))))
    .filter((lesson) => lesson.runtime.kind === 'php');
}

/**
 * Ejecuta código PHP igual que `PhpRunner`: prelude delante y motor nuevo.
 *
 * Si esto y el runner divergen, el test miente — por eso comparte el prelude
 * en vez de traerse una copia.
 */
async function runPhp(source: string): Promise<{ stdout: string; error: string | null }> {
  const uniter = require('uniter') as { createEngine(language: 'PHP'): PhpEngine };
  const engine = uniter.createEngine('PHP');

  let stdout = '';
  engine.getStdout().on('data', (data) => {
    stdout += String(data);
  });

  try {
    await engine.execute(`<?php ${PHP_PRELUDE}\n${source.replace(/^\s*<\?php\s*/i, '')}`);
    return { stdout, error: null };
  } catch (cause) {
    return { stdout, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

test('⭐ el prelude se carga solo, sin código de usuario', async () => {
  const { error } = await runPhp('echo 1;');
  assert.equal(error, null, `el prelude no se ejecuta: ${error}`);
});

test('⭐ las funciones que rellena el prelude se comportan como las de PHP', async () => {
  const { stdout, error } = await runPhp(`
    $n = [3, 1, 2];
    sort($n);
    echo implode(',', $n), '|';
    echo array_sum([1, 2, 3]), '|';
    echo round(3.456, 2), '|';
    echo floor(-3.2), '|';
    echo str_pad('7', 3, '0', STR_PAD_LEFT), '|';
    echo json_encode(['a' => 1, 'b' => [1, 2]]), '|';
    echo implode(',', array_reverse(explode(' ', 'uno dos tres')));
  `);

  assert.equal(error, null);
  assert.equal(stdout, '1,2,3|6|3.46|-4|007|{"a":1,"b":[1,2]}|tres,dos,uno');
});

test('⭐ una función que no existe se dice con su nombre, no con un fallo mudo', async () => {
  const { error } = await runPhp('echo str_word_count("hola mundo");');
  assert.match(String(error), /undefined function str_word_count/);
});

for (const lesson of phpLessons()) {
  const localized = localize(lesson, 'es');
  const ruleById = new Map(localized.rules.map((rule) => [rule.id, rule]));

  /*
   * Cada paso contra SU propia solución.
   *
   * Con un ejercicio por paso, el archivo final ya no cumple —ni debe— las
   * reglas de los anteriores. Sin `step.solution`, las promesas de todos los
   * pasos menos el último se quedarían sin comprobar, que es justo donde se
   * cuela una salida esperada mal copiada.
   */
  for (const [index, step] of localized.steps.entries()) {
    const referenciaCruda = (step.solution ?? lesson.solution?.files ?? []).find(
      (file) => file.path === lesson.workspace.entry,
    )?.content;
    const reference = referenciaCruda === undefined ? undefined : codigoDe(referenciaCruda);

    test(`⭐ ${lesson.id} · paso ${index + 1} (${step.id}): la solución corre y cumple lo que promete`, async () => {
      assert.ok(reference, `el paso ${step.id} no publica solución para ${lesson.workspace.entry}`);

      const { stdout, error } = await runPhp(reference);
      assert.equal(error, null, `la solución de referencia no se ejecuta: ${error}`);

      const context = emptyContext({
        hasRun: true,
        stdout,
        exitCode: 0,
        files: { [lesson.workspace.entry]: reference },
      });

      for (const id of step.ruleIds) {
        const rule = ruleById.get(id);
        assert.ok(rule, `el paso ${step.id} referencia una regla inexistente: ${id}`);

        const result = evaluateRule(rule as never, context);
        assert.ok(result, `la regla "${id}" quedó pendiente contra su propia solución`);
        assert.equal(
          result.passed,
          true,
          `[${lesson.id} · ${step.id}] "${id}" falla contra su propia solución: ` +
            `esperado ${result.detail?.expected ?? '—'}, obtenido ${result.detail?.actual ?? '—'}`,
        );
      }
    });
  }

  test(`⭐ ${lesson.id}: el archivo de partida NO pasa las comprobaciones`, async () => {
    const partida = lesson.workspace.files.find(
      (file) => file.path === lesson.workspace.entry,
    )?.content;
    const starter = partida === undefined ? undefined : codigoDe(partida);
    assert.ok(starter);

    const { stdout } = await runPhp(starter);
    const context = emptyContext({
      hasRun: true,
      stdout,
      exitCode: 0,
      files: { [lesson.workspace.entry]: starter },
    });

    const bloqueantes = localized.rules.filter((rule) => rule.severity === 'error');
    const superadas = bloqueantes.filter((rule) => evaluateRule(rule as never, context)?.passed);

    /*
     * Tiene que quedar algo por hacer. No se exige que **ninguna** regla pase:
     * una `regex-forbid` pasa siempre mientras el archivo no contenga lo
     * prohibido, y eso no significa que el ejercicio esté resuelto.
     */
    assert.ok(
      superadas.length < bloqueantes.length,
      `el archivo de partida ya cumple todas las comprobaciones: no hay ejercicio`,
    );
  });
}
