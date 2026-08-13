import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateExpression,
  extractMethod,
  formatTestOutput,
  parseInlineData,
  runTests,
} from '@/lib/runners/cli-sim/csharp';

/**
 * El evaluador simulado de C# (ADR-14).
 *
 * Lo que se prueba aquí no es que la salida «parezca» la de `dotnet test`: es
 * que **sale del código del usuario**. Un simulador que imprime lo que la
 * lección espera oír es un decorado, y la diferencia entre las dos cosas se ve
 * exactamente en estos tests — con un método mal escrito tienen que salir
 * fallos, y con uno bien escrito, ninguno.
 */

const TESTS = `
public class LeapTests
{
    [InlineData(1996, true)]
    [InlineData(1900, false)]
    [InlineData(2000, true)]
    [InlineData(2001, false)]
    public void EsBisiesto(int year, bool expected) => Assert.Equal(expected, Leap.EsBisiesto(year));
}
`;

const CORRECT = `
public static class Leap
{
    public static bool EsBisiesto(int year) =>
        year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
}
`;

/** El error clásico: se olvida la excepción del año 400. */
const WRONG = `
public static class Leap
{
    public static bool EsBisiesto(int year) => year % 4 == 0 && year % 100 != 0;
}
`;

test('los casos salen del fichero de pruebas que el usuario ve', () => {
  const cases = parseInlineData(TESTS);
  assert.equal(cases.length, 4);
  assert.deepEqual(cases[0], { args: [1996], expected: true });
  assert.deepEqual(cases[1], { args: [1900], expected: false });
});

test('reconoce el cuerpo de expresión y el cuerpo con llaves', () => {
  const arrow = extractMethod(CORRECT, 'EsBisiesto');
  assert.deepEqual(arrow?.parameters, ['year']);
  assert.match(arrow?.expression ?? '', /year % 4 == 0/);

  const braces = extractMethod(
    'public static bool EsBisiesto(int year)\n{\n    return year % 4 == 0;\n}',
    'EsBisiesto',
  );
  assert.equal(braces?.expression, 'year % 4 == 0');
});

test('`==` se compara sin coerción, como en C#', () => {
  // Con el `==` laxo de JavaScript esto sería `true`, y en C# ni compila.
  assert.equal(evaluateExpression('a == b', { a: 0, b: false }), false);
});

test('la división de enteros trunca, como en C#', () => {
  assert.equal(evaluateExpression('7 / 2', {}), 3);
});

test('⭐ la solución correcta pasa los cuatro casos', () => {
  const outcome = runTests(CORRECT, TESTS, 'EsBisiesto');
  assert.equal(outcome.error, undefined);
  assert.equal(outcome.failed, 0);
  assert.equal(outcome.passed, 4);
});

test('⭐ una solución incorrecta FALLA, y dice en qué caso', () => {
  // Es la prueba de que el simulador no es un decorado: si imprimiera siempre
  // lo que la lección espera, este test pasaría con cualquier código.
  const outcome = runTests(WRONG, TESTS, 'EsBisiesto');
  assert.equal(outcome.failed, 1);
  assert.deepEqual(outcome.failures[0], { args: [2000], expected: true, actual: false });

  const output = formatTestOutput(outcome, 'Leap');
  assert.match(output, /Con error: 1/);
  assert.match(output, /2000/);
});

test('⭐ lo que está fuera del subconjunto se dice, no se inventa', () => {
  const withLoop = `
public static class Leap
{
    public static bool EsBisiesto(int year)
    {
        var contador = 0;
        return contador;
    }
}
`;
  const outcome = runTests(withLoop, TESTS, 'EsBisiesto');
  assert.ok(outcome.error, 'debe informar de que no puede simularlo');
  assert.equal(outcome.passed, 0);
  assert.match(formatTestOutput(outcome, 'Leap'), /error CS/);
});

test('un método que no existe se reporta como error de compilación', () => {
  const outcome = runTests('public class Vacio {}', TESTS, 'EsBisiesto');
  assert.match(outcome.error ?? '', /EsBisiesto/);
});
