import type { SqlQueryResult, Validator } from '../context';
import { verdict } from '../context';

/**
 * Comprueba el resultado de una consulta SQL (ADR-11).
 *
 * Juzga el **conjunto de filas devuelto**, nunca el texto de la consulta. Un
 * `WHERE precio > 100` y un `WHERE NOT precio <= 100` devuelven lo mismo y las
 * dos son respuestas válidas; suspender la segunda sería corregir el estilo
 * disfrazado de corregir el resultado. Cuando la lección sí quiere una forma
 * concreta —«resuélvelo con un JOIN»— eso se pide con `regex-must`, y así
 * queda explícito en el enunciado en lugar de escondido en la comparación.
 *
 * El orden **no** se exige por defecto: sin `ORDER BY`, Postgres no garantiza
 * ninguno. Exigirlo sería exigir suerte.
 */

/** Comparación laxa a propósito: `1` y `"1"` son la misma respuesta. */
function sameValue(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (actual === null || actual === undefined) return expected === null || expected === undefined;
  if (expected === null || expected === undefined) return false;

  /*
   * `numeric` vuelve de Postgres como string —no cabe en un `number` sin
   * perder precisión— y `int` como número. Una lección no debería tener que
   * saber cuál de los dos le va a tocar para escribir su fila esperada.
   */
  if (typeof actual === 'number' || typeof expected === 'number') {
    const a = Number(actual);
    const b = Number(expected);
    if (!Number.isNaN(a) && !Number.isNaN(b)) return a === b;
  }

  if (actual instanceof Date && typeof expected === 'string') {
    return actual.toISOString().startsWith(expected);
  }

  return String(actual) === String(expected);
}

/** Una fila coincide si todas las columnas esperadas coinciden. */
function sameRow(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([column, value]) => sameValue(actual[column], value));
}

function preview(rows: Array<Record<string, unknown>>, limit = 3): string {
  if (rows.length === 0) return '(sin filas)';
  const shown = rows.slice(0, limit).map((row) => JSON.stringify(row)).join(', ');
  return rows.length > limit ? `${shown}, … (+${rows.length - limit})` : shown;
}

export const sqlResult: Validator<'sql-result'> = (rule, context) => {
  // Sin ejecutar no hay veredicto: gris, no rojo.
  if (!context.hasRun) return null;

  const result: SqlQueryResult | null = context.sql;
  if (!result) {
    return verdict(false, {
      detail: {
        expected: 'una consulta que se ejecute sin error',
        actual: context.stderr.split('\n')[0] || 'la consulta falló',
      },
    });
  }

  if (rule.expectColumns) {
    const actual = result.columns;
    const matches =
      actual.length === rule.expectColumns.length &&
      rule.expectColumns.every((column, index) => column === actual[index]);
    if (!matches) {
      return verdict(false, {
        detail: { expected: rule.expectColumns.join(', '), actual: actual.join(', ') || '(ninguna)' },
      });
    }
  }

  if (rule.expectRowCount !== undefined && result.rows.length !== rule.expectRowCount) {
    return verdict(false, {
      detail: {
        expected: `${rule.expectRowCount} fila(s)`,
        actual: `${result.rows.length} fila(s)`,
      },
    });
  }

  if (rule.expectRows) {
    const expected = rule.expectRows;

    if (result.rows.length !== expected.length) {
      return verdict(false, {
        detail: {
          expected: `${expected.length} fila(s): ${preview(expected)}`,
          actual: `${result.rows.length} fila(s): ${preview(result.rows)}`,
        },
      });
    }

    if (rule.ordered) {
      const wrong = expected.findIndex((row, index) => !sameRow(result.rows[index] ?? {}, row));
      if (wrong !== -1) {
        return verdict(false, {
          detail: {
            expected: `fila ${wrong + 1}: ${JSON.stringify(expected[wrong])}`,
            actual: `fila ${wrong + 1}: ${JSON.stringify(result.rows[wrong] ?? null)}`,
          },
        });
      }
    } else {
      /*
       * Emparejamiento sin reutilizar filas: dos filas esperadas iguales
       * exigen dos filas reales iguales. Con un `some` suelto, un resultado
       * con la fila correcta duplicada pasaría por dos filas distintas.
       */
      const remaining = [...result.rows];
      for (const row of expected) {
        const index = remaining.findIndex((candidate) => sameRow(candidate, row));
        if (index === -1) {
          return verdict(false, {
            detail: { expected: JSON.stringify(row), actual: preview(result.rows) },
          });
        }
        remaining.splice(index, 1);
      }
    }
  }

  return verdict(true);
};
