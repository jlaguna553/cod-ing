import type { ValidationRule } from '@/lib/content/types';
import { emptyContext, evaluateRule } from './index';

/**
 * Lo que el servidor puede comprobar **sin ejecutar el código del usuario**.
 *
 * Es la mitad honesta de un problema que no tiene solución completa gratis. El
 * XP lo concede el servidor desde la Fase 6, pero hasta ahora se lo concedía a
 * quien dijera «he terminado»: bastaba una petición desde la consola del
 * navegador. Verificarlo del todo exigiría ejecutar el código en el servidor
 * —una caja aislada por usuario y por petición— y eso cuesta dinero y abre una
 * superficie de ataque que aquí no compensa.
 *
 * Lo que sí se puede hacer sin ejecutar nada es mirar **el código enviado**:
 * si contiene lo que la lección pide, si no contiene lo que prohíbe, si su AST
 * tiene la forma esperada, si el `Dockerfile` cumple. Con eso, «reclamar el XP»
 * deja de ser una petición y pasa a ser: *manda un código que pase las
 * comprobaciones*. Que es, exactamente, hacer el ejercicio.
 *
 * Las que **no** están aquí —`stdout-match`, `dom-assert`, `sql-result`,
 * `cli-transcript`— necesitan una ejecución para significar algo, y el
 * servidor no la tiene. No se fingen: se cuentan como no verificadas y se dice.
 */
export const STATIC_KINDS = new Set<ValidationRule['kind']>([
  'regex-must',
  'regex-forbid',
  'ast-query',
  'file-exists',
  'dockerfile-lint',
  'yaml-path',
]);

export interface Verificacion {
  /** Cuántas reglas se pudieron juzgar sin ejecutar nada. */
  comprobadas: number;
  /** Cuántas quedaron fuera del alcance del servidor. */
  fueraDeAlcance: number;
  /** Ids de las que fallaron. Vacío no significa «todo bien»: ver `comprobadas`. */
  fallidas: string[];
}

/**
 * Juzga las reglas que se pueden juzgar contra los archivos enviados.
 *
 * Solo mira las **bloqueantes** (`severity: 'error'`): un aviso de estilo no
 * puede impedir que alguien cobre lo que ha trabajado.
 */
export function verifyStatic(
  rules: ValidationRule[],
  files: Record<string, string>,
): Verificacion {
  const bloqueantes = rules.filter((rule) => rule.severity === 'error');
  const estaticas = bloqueantes.filter((rule) => STATIC_KINDS.has(rule.kind));

  const context = emptyContext({ files });
  const fallidas: string[] = [];

  for (const rule of estaticas) {
    const veredicto = evaluateRule(rule as never, context);
    // `null` es «no me puedo pronunciar», y eso no es un fallo del usuario.
    if (veredicto && !veredicto.passed) fallidas.push(rule.id);
  }

  return {
    comprobadas: estaticas.length,
    fueraDeAlcance: bloqueantes.length - estaticas.length,
    fallidas,
  };
}
