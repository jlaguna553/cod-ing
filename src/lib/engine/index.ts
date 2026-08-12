import type {
  RuleResult,
  StepEvaluation,
  ValidationRule,
} from '@/lib/content/types';
import type { EvaluationContext, Validator } from './context';
import { astQuery } from './validators/ast';
import { dockerfileLint } from './validators/dockerfile-lint';
import { domAssert } from './validators/dom';
import { cliTranscript, fileExists, regexForbid, regexMust, stdoutMatch } from './validators/text';

export type { EvaluationContext } from './context';
export { emptyContext } from './context';
export { findSyntaxError } from './validators/ast';

/**
 * Registro `kind → validador`.
 *
 * Añadir un tipo de comprobación es añadir una variante al schema y una
 * entrada aquí. Nada más cambia: ni la UI, ni el dispatcher, ni el contenido
 * ya escrito.
 *
 * Los que faltan (`yaml-path`, `unit-test`, `http-assert`, `custom`) están
 * declarados en el schema pero **ninguna lección los usa todavía**. Se
 * implementarán cuando exista contenido que los ejercite, por el mismo motivo
 * que Pyodide en la Fase 3.
 */
/**
 * Firma común del registro.
 *
 * Cada validador declara el tipo estrecho de regla que entiende, pero la tabla
 * los guarda juntos. TypeScript no puede verificar esa correspondencia —los
 * parámetros de función son contravariantes—, así que el cast es deliberado y
 * está confinado a estas ocho líneas: `evaluateRule` solo invoca el validador
 * que la propia clave `kind` selecciona, de modo que la regla siempre llega al
 * validador correcto en tiempo de ejecución.
 */
type RegisteredValidator = (
  rule: ValidationRule,
  context: EvaluationContext,
) => ReturnType<Validator>;

const as = <K extends ValidationRule['kind']>(validator: Validator<K>) =>
  validator as unknown as RegisteredValidator;

const VALIDATORS: Partial<Record<ValidationRule['kind'], RegisteredValidator>> = {
  'regex-must': as(regexMust),
  'regex-forbid': as(regexForbid),
  'file-exists': as(fileExists),
  'stdout-match': as(stdoutMatch),
  'cli-transcript': as(cliTranscript),
  'ast-query': as(astQuery),
  'dom-assert': as(domAssert),
  'dockerfile-lint': as(dockerfileLint),
};

export function isImplemented(kind: ValidationRule['kind']): boolean {
  return VALIDATORS[kind] !== undefined;
}

/**
 * Evalúa una regla. `null` significa **pendiente**: el validador no puede
 * pronunciarse todavía (no se ha ejecutado nada, el código no compila aún).
 *
 * Distinguir "pendiente" de "falla" no es un detalle: pintar en rojo algo que
 * el usuario no ha tenido ocasión de hacer mal es la forma más rápida de que
 * deje de confiar en el evaluador.
 */
export function evaluateRule(
  rule: ValidationRule & { message: string },
  context: EvaluationContext,
): RuleResult | null {
  const validator = VALIDATORS[rule.kind];
  if (!validator) return null;

  const outcome = validator(rule, context);
  if (outcome === null) return null;

  return {
    ruleId: rule.id,
    kind: rule.kind,
    severity: rule.severity,
    message: rule.message,
    points: rule.points,
    ...outcome,
  };
}

/** Evalúa las reglas de una fase concreta. */
export function evaluateRules(
  rules: (ValidationRule & { message: string })[],
  context: EvaluationContext,
  phase?: ValidationRule['phase'],
): RuleResult[] {
  return rules
    .filter((rule) => phase === undefined || rule.phase === phase)
    .map((rule) => evaluateRule(rule, context))
    .filter((result): result is RuleResult => result !== null);
}

/**
 * Veredicto de un paso.
 *
 * Un paso se supera cuando ninguna regla de severidad `error` falla. Las
 * `warn` restan puntuación pero no bloquean —son consejos de estilo, no
 * requisitos— y las `damage` solo quitan energía: son feedback al escribir,
 * no criterio de corrección.
 */
export function evaluateStep(
  stepId: string,
  rules: (ValidationRule & { message: string })[],
  context: EvaluationContext,
): StepEvaluation {
  const results = evaluateRules(rules, context);

  const blocking = results.filter((result) => result.severity === 'error');
  const passed = blocking.every((result) => result.passed);

  const score = results.filter((result) => result.passed).reduce((sum, r) => sum + r.points, 0);
  const maxScore = rules.reduce((sum, rule) => sum + rule.points, 0);

  return { stepId, passed, results, score, maxScore };
}
