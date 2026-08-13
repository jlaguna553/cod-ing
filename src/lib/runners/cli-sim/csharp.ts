import { parseExpressionAt } from 'acorn';
import type { Expression, Node } from 'acorn';

/**
 * Evaluador simulado de C# (ADR-14).
 *
 * Ejecutar C# de verdad en el navegador cuesta decenas de megas de WASM, y en
 * el servidor cuesta dinero. La restricción del proyecto es coste cero, así que
 * aquí se **simula la ejecución**, con una regla que decide si la simulación
 * vale algo o es un decorado:
 *
 * > La salida se calcula a partir del código del usuario. Nunca se imprime lo
 * > que la lección espera oír.
 *
 * Lo que se simula es un subconjunto acotado y declarado: el **cuerpo de un
 * método que devuelve una expresión**. Es suficiente para los ejercicios
 * clásicos de lógica —años bisiestos, FizzBuzz, validaciones— que son
 * justamente donde el alumno se equivoca, y deja fuera cualquier cosa con
 * estado, bucles o E/S. Cuando una lección los necesite, hará falta un runtime
 * de verdad y este módulo no debe estirarse para fingir que lo es.
 *
 * Los operadores del subconjunto —`%`, `&&`, `||`, `==`, `!=`, `<`, `>`, `!`—
 * significan lo mismo en C# y en JavaScript sobre enteros y booleanos, así que
 * la expresión se analiza con el parser que ya está en el proyecto y se
 * interpreta sobre su AST. No se usa `eval`: el árbol se recorre a mano y solo
 * se acepta lo que está en la lista.
 */

export interface TestCase {
  args: Array<number | string | boolean>;
  expected: number | string | boolean;
}

export interface TestOutcome {
  passed: number;
  failed: number;
  failures: Array<{ args: unknown[]; expected: unknown; actual: unknown }>;
  /** Error de «compilación»: el método no se encontró o usa algo fuera del subconjunto. */
  error?: string;
}

/**
 * Lee los casos de un fichero de pruebas de xUnit.
 *
 * Se sacan de `[InlineData(...)]`, que es exactamente lo que el usuario tiene
 * delante en el editor: los casos que se ejecutan son los que él puede leer, no
 * una lista escondida en el simulador.
 */
export function parseInlineData(source: string): TestCase[] {
  const cases: TestCase[] = [];

  for (const match of source.matchAll(/\[InlineData\(([^)]*)\)\]/g)) {
    const values = match[1]
      .split(',')
      .map((raw) => raw.trim())
      .filter((raw) => raw !== '')
      .map(literal);

    if (values.length < 2) continue;
    cases.push({ args: values.slice(0, -1), expected: values.at(-1)! });
  }

  return cases;
}

function literal(raw: string): number | string | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw.replace(/^"|"$/g, '');
}

/**
 * Extrae los parámetros y la expresión devuelta por un método.
 *
 * Reconoce las dos formas que usa C# moderno: el cuerpo con llaves y `return`,
 * y el cuerpo de expresión con `=>`. Deliberadamente **no** entiende bucles ni
 * variables locales: si el método las usa, se devuelve `null` y el simulador
 * lo dice en lugar de inventarse un resultado.
 */
export function extractMethod(
  source: string,
  methodName: string,
): { parameters: string[]; expression: string } | null {
  const signature = new RegExp(
    `\\b(?:public|internal|private|protected)?\\s*(?:static\\s+)?[\\w<>\\[\\]?]+\\s+${methodName}\\s*\\(([^)]*)\\)\\s*(=>|\\{)`,
  );
  const match = signature.exec(source);
  if (!match) return null;

  const parameters = match[1]
    .split(',')
    .map((parameter) => parameter.trim())
    .filter((parameter) => parameter !== '')
    .map((parameter) => parameter.split(/\s+/).at(-1) ?? '');

  const rest = source.slice(match.index + match[0].length);

  if (match[2] === '=>') {
    const end = rest.indexOf(';');
    return end === -1 ? null : { parameters, expression: rest.slice(0, end).trim() };
  }

  const returnMatch = /\breturn\b([^;]*);/.exec(rest);
  if (!returnMatch) return null;
  return { parameters, expression: returnMatch[1].trim() };
}

/** Operadores del subconjunto. Cualquier otro se rechaza en vez de adivinarse. */
const BINARY = new Set(['%', '*', '/', '+', '-', '==', '!=', '<', '<=', '>', '>=', '&&', '||']);

/**
 * Interpreta la expresión sobre el AST, sin `eval`.
 *
 * `==` de C# sobre enteros y booleanos es `===` de JavaScript; se traduce así
 * a propósito, para que `0 == false` no pase por cierto como haría el `==` laxo
 * de JavaScript — en C# eso ni siquiera compila.
 */
function evaluateNode(node: Node, scope: Record<string, unknown>): unknown {
  const expression = node as Expression & Record<string, never>;

  switch (expression.type) {
    case 'Literal':
      return (expression as unknown as { value: unknown }).value;

    case 'Identifier': {
      const name = (expression as unknown as { name: string }).name;
      if (!(name in scope)) throw new Error(`no se conoce '${name}'`);
      return scope[name];
    }

    case 'ParenthesizedExpression':
      return evaluateNode((expression as unknown as { expression: Node }).expression, scope);

    case 'UnaryExpression': {
      const unary = expression as unknown as { operator: string; argument: Node };
      const value = evaluateNode(unary.argument, scope);
      if (unary.operator === '!') return !value;
      if (unary.operator === '-') return -(value as number);
      throw new Error(`operador '${unary.operator}' fuera del subconjunto`);
    }

    case 'LogicalExpression':
    case 'BinaryExpression': {
      const binary = expression as unknown as { operator: string; left: Node; right: Node };
      if (!BINARY.has(binary.operator)) {
        throw new Error(`operador '${binary.operator}' fuera del subconjunto`);
      }

      const left = evaluateNode(binary.left, scope) as number & boolean;
      // Corto circuito, igual que en C#.
      if (binary.operator === '&&') return left && (evaluateNode(binary.right, scope) as boolean);
      if (binary.operator === '||') return left || (evaluateNode(binary.right, scope) as boolean);

      const right = evaluateNode(binary.right, scope) as number & boolean;
      switch (binary.operator) {
        case '%': return left % right;
        case '*': return left * right;
        case '/': return Math.trunc(left / right); // división entera de C#
        case '+': return left + right;
        case '-': return left - right;
        case '==': return left === right;
        case '!=': return left !== right;
        case '<': return left < right;
        case '<=': return left <= right;
        case '>': return left > right;
        case '>=': return left >= right;
      }
      throw new Error(`operador '${binary.operator}' fuera del subconjunto`);
    }

    case 'ConditionalExpression': {
      const conditional = expression as unknown as { test: Node; consequent: Node; alternate: Node };
      return evaluateNode(conditional.test, scope)
        ? evaluateNode(conditional.consequent, scope)
        : evaluateNode(conditional.alternate, scope);
    }

    default:
      throw new Error(`'${expression.type}' fuera del subconjunto simulado`);
  }
}

/** Evalúa la expresión con unos valores concretos para sus parámetros. */
export function evaluateExpression(
  expression: string,
  scope: Record<string, unknown>,
): unknown {
  const ast = parseExpressionAt(expression, 0, { ecmaVersion: 2022 });
  return evaluateNode(ast, scope);
}

/**
 * Ejecuta los casos del fichero de pruebas contra el método del usuario.
 *
 * Devuelve el recuento real. Si el método no se encuentra o usa algo fuera del
 * subconjunto, se informa como error de ejecución en vez de contar como fallo
 * de las pruebas: son cosas distintas y confundirlas engaña.
 */
export function runTests(
  source: string,
  testSource: string,
  methodName: string,
): TestOutcome {
  const method = extractMethod(source, methodName);
  if (!method) {
    return {
      passed: 0,
      failed: 0,
      failures: [],
      error: `No se encontró un método '${methodName}' que devuelva una expresión.`,
    };
  }

  const cases = parseInlineData(testSource);
  const outcome: TestOutcome = { passed: 0, failed: 0, failures: [] };

  for (const testCase of cases) {
    const scope: Record<string, unknown> = {};
    method.parameters.forEach((parameter, index) => {
      scope[parameter] = testCase.args[index];
    });

    let actual: unknown;
    try {
      actual = evaluateExpression(method.expression, scope);
    } catch (cause) {
      return {
        passed: 0,
        failed: 0,
        failures: [],
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }

    if (actual === testCase.expected) outcome.passed += 1;
    else {
      outcome.failed += 1;
      outcome.failures.push({ args: testCase.args, expected: testCase.expected, actual });
    }
  }

  return outcome;
}

/**
 * Qué método se está probando, deducido del propio fichero de pruebas.
 *
 * Se saca de la llamada dentro del `Assert`, así que la lección no tiene que
 * declararlo en ningún sitio: cambiar el nombre en el test cambia lo que se
 * ejecuta, como pasaría de verdad.
 */
export function detectTarget(testSource: string): string | null {
  const match = /Assert\.\w+\([^)]*?\b\w+\.(\w+)\s*\(/.exec(testSource);
  return match?.[1] ?? null;
}

/** Salida con la forma de `dotnet test`, para que se lea como la de verdad. */
export function formatTestOutput(outcome: TestOutcome, project: string): string {
  if (outcome.error) {
    return [
      `  Determinando los proyectos que se van a restaurar...`,
      `  ${project} -> /app/bin/Debug/net8.0/${project}.dll`,
      ``,
      `error CS0000: ${outcome.error}`,
      ``,
      `Error de compilación.`,
    ].join('\n');
  }

  const total = outcome.passed + outcome.failed;
  const lines = [
    `  Determinando los proyectos que se van a restaurar...`,
    `  ${project} -> /app/bin/Debug/net8.0/${project}.dll`,
    ``,
  ];

  for (const failure of outcome.failures) {
    lines.push(
      `  Con error ${project}.Tests(${failure.args.join(', ')})`,
      `    Assert.Equal() Failure: Values differ`,
      `    Esperado: ${failure.expected}`,
      `    Real:     ${failure.actual}`,
      ``,
    );
  }

  lines.push(
    outcome.failed === 0
      ? `¡Correctos! - Con error: 0, Superados: ${outcome.passed}, Total: ${total}`
      : `Con error! - Con error: ${outcome.failed}, Superados: ${outcome.passed}, Total: ${total}`,
  );

  return lines.join('\n');
}
