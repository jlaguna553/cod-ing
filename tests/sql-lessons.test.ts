import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LessonSchema } from '@/lib/content/lesson.schema';
import { codigoDe, localize } from '@/lib/content/localize';
import type { Lesson } from '@/lib/content/types';
import { emptyContext, evaluateRule } from '@/lib/engine';
import type { SqlQueryResult } from '@/lib/engine/context';

/**
 * Las lecciones de SQL, ejecutadas contra un PostgreSQL de verdad.
 *
 * Es el test que más valor da de todo el repositorio de contenido: una regla
 * `sql-result` afirma qué filas debe devolver una consulta, y esa afirmación
 * solo se puede verificar **ejecutándola**. Escribir a mano las filas
 * esperadas en el JSON de la lección es exactamente el sitio donde se cuela
 * una tilde de más, un precio con dos decimales o una fila olvidada.
 *
 * En Node se usa el mismo PGlite que en el navegador, así que lo que pasa aquí
 * es lo que le va a pasar al usuario.
 */

function sqlLessons(): Lesson[] {
  const root = path.resolve(import.meta.dirname, '../content/lessons');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : entry.name.endsWith('.lesson.json') ? [full] : [];
    });

  return walk(root)
    .map((file) => LessonSchema.parse(JSON.parse(readFileSync(file, 'utf8'))))
    .filter((lesson) => lesson.runtime.kind === 'sql');
}

/**
 * Ejecuta una consulta con el esquema de la lección ya aplicado.
 *
 * Réplica exacta de lo que hace `SqlRunner`: los `.sql` que no son la entrada
 * se aplican en orden como semilla, y la consulta corre dentro de una
 * transacción que se deshace. Si esto y el runner divergen, el test miente.
 */
async function runQuery(lesson: Lesson, sql: string): Promise<SqlQueryResult | { error: string }> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();

  const files = Object.fromEntries(lesson.workspace.files.map((f) => [f.path, f.content]));
  const seeds = Object.keys(files)
    .filter((file) => file !== lesson.workspace.entry && file.endsWith('.sql'))
    .sort();

  for (const seed of seeds) await db.exec(codigoDe(files[seed]));

  await db.exec('BEGIN');
  try {
    const batches = await db.exec(sql);
    const last = batches.at(-1);
    return {
      columns: last?.fields.map((field) => field.name) ?? [],
      rows: (last?.rows ?? []) as Array<Record<string, unknown>>,
      rowCount: last?.rows.length ?? 0,
    };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    await db.exec('ROLLBACK');
    await db.close();
  }
}

for (const lesson of sqlLessons()) {
  const localized = localize(lesson, 'es');
  const ruleById = new Map(localized.rules.map((rule) => [rule.id, rule]));

  test(`⭐ ${lesson.id}: el esquema de la lección se aplica sin errores`, async () => {
    const outcome = await runQuery(lesson, 'SELECT 1 AS ok');
    assert.ok(!('error' in outcome), `el esquema falló: ${'error' in outcome ? outcome.error : ''}`);
  });

  /*
   * Cada paso se verifica contra SU propia solución.
   *
   * Con un ejercicio por paso, la consulta final ya no cumple —ni debe— las
   * reglas de los pasos anteriores: la del paso 3 filtra por otra cosa. Sin
   * `step.solution`, las promesas de todos los pasos menos el último se
   * quedaban sin comprobar, que es justo donde se cuela un enunciado
   * imposible o unas filas esperadas mal copiadas.
   */
  for (const [index, step] of localized.steps.entries()) {
    const sqlRules = step.ruleIds
      .map((id) => ruleById.get(id))
      .filter((rule): rule is NonNullable<typeof rule> => rule?.kind === 'sql-result');

    if (sqlRules.length === 0) continue;

    const referenciaCruda = (step.solution ?? lesson.solution?.files ?? []).find(
      (file) => file.path === lesson.workspace.entry,
    )?.content;
    const reference = referenciaCruda === undefined ? undefined : codigoDe(referenciaCruda);

    test(`⭐ ${lesson.id} · paso ${index + 1} (${step.id}): la consulta de referencia cumple lo que promete`, async () => {
      assert.ok(
        reference,
        `el paso ${step.id} tiene reglas SQL pero ninguna solución que las verifique`,
      );

      const outcome = await runQuery(lesson, reference);
      assert.ok(
        !('error' in outcome),
        `la consulta de referencia no se ejecuta: ${'error' in outcome ? outcome.error : ''}`,
      );

      const context = emptyContext({ hasRun: true, sql: outcome });
      for (const rule of sqlRules) {
        const result = evaluateRule(rule as never, context);
        assert.ok(result, `la regla "${rule.id}" quedó pendiente contra su solución`);
        assert.equal(
          result.passed,
          true,
          `[${lesson.id} · ${step.id}] "${rule.id}" falla contra su propia solución: ` +
            `esperado ${result.detail?.expected ?? '—'}, obtenido ${result.detail?.actual ?? '—'}`,
        );
      }
    });
  }

  test(`⭐ ${lesson.id}: la consulta de partida NO pasa las comprobaciones`, async () => {
    const partida = lesson.workspace.files.find(
      (file) => file.path === lesson.workspace.entry,
    )?.content;
    const starter = partida === undefined ? undefined : codigoDe(partida);
    assert.ok(starter);

    const outcome = await runQuery(lesson, starter);
    const context = emptyContext({
      hasRun: true,
      sql: 'error' in outcome ? null : outcome,
      stderr: 'error' in outcome ? outcome.error : '',
    });

    const blocking = localized.rules.filter(
      (rule) => rule.kind === 'sql-result' && rule.severity === 'error',
    );
    const verdicts = blocking.map((rule) => evaluateRule(rule as never, context));
    assert.ok(
      verdicts.some((result) => result && !result.passed),
      `[${lesson.id}] el código de partida ya supera todas las comprobaciones: no hay nada que resolver`,
    );
  });
}
