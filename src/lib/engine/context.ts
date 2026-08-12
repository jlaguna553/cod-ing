import type { RuleResult, RuleSeverity, ValidationRule } from '@/lib/content/types';

/**
 * Todo lo que un validador puede necesitar para juzgar el trabajo del usuario.
 *
 * Se pasa completo a todos, y cada uno toma lo suyo. La alternativa —que cada
 * validador se busque la vida accediendo a stores— los haría imposibles de
 * probar fuera del navegador, que es justo donde más falta hace probarlos.
 */
export interface EvaluationContext {
  /** Buffer actual: ruta → contenido. */
  files: Record<string, string>;
  /** Salida de la última ejecución. */
  stdout: string;
  stderr: string;
  exitCode: number;
  /** ¿Se ha ejecutado el código alguna vez? Sin esto, `stdout` vacío es ambiguo. */
  hasRun: boolean;
  /** DOM renderizado, si el runner lo expone. Ausente fuera del navegador. */
  document: Document | null;
  /** Comandos que el usuario ha ejecutado, en orden. */
  transcript: string[];
}

export function emptyContext(partial: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    files: {},
    stdout: '',
    stderr: '',
    exitCode: 0,
    hasRun: false,
    document: null,
    transcript: [],
    ...partial,
  };
}

/**
 * Un validador juzga UNA regla contra el contexto.
 *
 * Devuelve `null` cuando no puede pronunciarse — por ejemplo `dom-assert` sin
 * documento, porque todavía no se ha ejecutado nada. Eso es distinto de fallar:
 * marcar como incorrecto lo que aún no se ha comprobado sería mentir al usuario.
 */
export type Validator<K extends ValidationRule['kind'] = ValidationRule['kind']> = (
  rule: Extract<ValidationRule, { kind: K }>,
  context: EvaluationContext,
) => Omit<RuleResult, 'ruleId' | 'kind' | 'severity' | 'message' | 'points'> | null;

/** Atajo para construir el veredicto de un validador. */
export function verdict(
  passed: boolean,
  extra: Partial<Pick<RuleResult, 'location' | 'detail'>> = {},
) {
  return { passed, ...extra };
}

export function severityOf(rule: ValidationRule): RuleSeverity {
  return rule.severity;
}
