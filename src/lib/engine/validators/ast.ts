import { Parser } from 'acorn';
import jsx from 'acorn-jsx';
import esquery from 'esquery';
import type { Validator } from '../context';
import { verdict } from '../context';

/**
 * Validación estructural sobre el AST.
 *
 * **Cambio respecto al schema original.** Se especificó con queries de
 * tree-sitter, pero llevarlo al navegador cuesta un WASM de 1-2 MB por
 * lenguaje, y las tres reglas que lo usan hoy son todas de JavaScript/JSX.
 * `acorn` + `esquery` cubren ese caso con una fracción del peso y con
 * selectores tipo CSS, que además se leen mejor:
 *
 *   CallExpression[callee.property.name="map"]
 *   VariableDeclaration[kind="const"]
 *   CallExpression[callee.name="useState"]
 *
 * El día que haya lecciones de Python o Go habrá que volver a tree-sitter para
 * ESOS lenguajes — el registro de validadores permite tener ambos sin que la
 * UI ni el contenido se enteren.
 *
 * Por qué AST y no regex: `// const x = 1` dentro de un comentario, o la
 * palabra `map` en un string, engañan a cualquier expresión regular. El AST no
 * ve comentarios ni literales como código.
 */

const JsxParser = Parser.extend(jsx());

interface ParseFailure {
  message: string;
  line: number;
}

function parse(source: string): { ast: unknown } | { error: ParseFailure } {
  try {
    return {
      ast: JsxParser.parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: true,
        allowReturnOutsideFunction: true,
      }),
    };
  } catch (cause) {
    const error = cause as { message?: string; loc?: { line?: number } };
    return {
      error: {
        message: error.message ?? 'código no parseable',
        line: error.loc?.line ?? 1,
      },
    };
  }
}

export const astQuery: Validator<'ast-query'> = (rule, context) => {
  const source = context.files[rule.file];
  if (source === undefined) {
    return verdict(false, { detail: { expected: `el archivo ${rule.file}`, actual: 'no existe' } });
  }

  const parsed = parse(source);
  if ('error' in parsed) {
    // Código a medio escribir no es un fallo de la regla: es que todavía no se
    // puede juzgar. Devolver `null` deja el test en "pendiente" en vez de rojo.
    return null;
  }

  let matches: unknown[];
  try {
    matches = esquery.match(
      parsed.ast as never,
      esquery.parse(rule.query) as never,
    ) as unknown[];
  } catch {
    return verdict(false, { detail: { actual: `selector inválido: ${rule.query}` } });
  }

  // `captureEquals` filtra por el valor de una propiedad del nodo encontrado.
  const filtered = rule.captureEquals
    ? matches.filter((node) =>
        Object.entries(rule.captureEquals ?? {}).every(
          ([path, expected]) => readPath(node, path) === expected,
        ),
      )
    : matches;

  const count = filtered.length;
  const meetsMin = count >= rule.minMatches;
  const meetsMax = rule.maxMatches === undefined || count <= rule.maxMatches;
  const passed = meetsMin && meetsMax;

  if (passed) return verdict(true);

  const expected =
    rule.maxMatches !== undefined
      ? `entre ${rule.minMatches} y ${rule.maxMatches} coincidencias`
      : `al menos ${rule.minMatches} coincidencia(s)`;

  return verdict(false, { detail: { expected, actual: `${count}` } });
};

/** Lee `a.b.c` sobre un nodo del AST. */
function readPath(node: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object') return (current as Record<string, unknown>)[key];
    return undefined;
  }, node);
}

/** Expuesto para el motor de feedback en vivo: errores de sintaxis al escribir. */
export function findSyntaxError(source: string): ParseFailure | null {
  const parsed = parse(source);
  return 'error' in parsed ? parsed.error : null;
}
