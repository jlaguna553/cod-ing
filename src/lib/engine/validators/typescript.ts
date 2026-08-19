import type { Validator } from '../context';
import { verdict } from '../context';

/**
 * Errores del compilador de TypeScript (ADR-25).
 *
 * Media lección de tipos consiste en **provocar** un error y leerlo, y la otra
 * media en que deje de aparecer. Por eso la regla mira el diagnóstico y no el
 * texto del código: hay muchas formas de escribir lo mismo, y una sola de que
 * el compilador se queje por el motivo correcto.
 *
 * Sin compilación previa devuelve `null` —pendiente—, no un fallo: aún no ha
 * habido ocasión de equivocarse.
 */
export const typeError: Validator<'type-error'> = (rule, context) => {
  const diagnosticos = context.diagnostics;
  if (diagnosticos === null) return null;

  if (rule.expectNone) {
    const primero = diagnosticos[0];
    return verdict(diagnosticos.length === 0, {
      detail:
        diagnosticos.length === 0
          ? undefined
          : {
              expected: 'compila sin errores',
              actual: `TS${primero.code}: ${primero.message}`,
            },
    });
  }

  const coincide = diagnosticos.filter((d) => {
    if (rule.expectCode !== undefined && d.code !== rule.expectCode) return false;
    if (rule.messageContains && !d.message.includes(rule.messageContains)) return false;
    return true;
  });

  return verdict(coincide.length > 0, {
    detail:
      coincide.length > 0
        ? undefined
        : {
            expected: rule.expectCode ? `error TS${rule.expectCode}` : 'un error de tipos',
            actual:
              diagnosticos.length === 0
                ? 'compila sin errores'
                : diagnosticos.map((d) => `TS${d.code}`).join(', '),
          },
    location: coincide[0] ? { file: coincide[0].file, line: coincide[0].line } : undefined,
  });
};
