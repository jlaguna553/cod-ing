import type { RuleResult, ValidationRule } from '@/lib/content/types';
import { evaluateRules, type EvaluationContext } from './index';

/**
 * Orquesta cuándo se evalúa qué.
 *
 * Tres fases con costes muy distintos:
 *
 * - `type`   → mientras escribe. Debe ser barata. Debounce de 120ms.
 * - `run`    → tras ejecutar. Ya hay stdout y DOM que mirar.
 * - `submit` → al validar el paso. Puede permitirse todo.
 *
 * El debounce de 120ms está por debajo del umbral de percepción y por encima
 * del ruido del tecleo: reevaluar en cada pulsación gastaría el hilo principal
 * en parsear código que el usuario está a medio escribir.
 */
export const TYPE_DEBOUNCE_MS = 120;

/**
 * Margen de gracia antes de mostrar daño.
 *
 * Una regla `damage` no dispara durante los primeros 800ms tras la última
 * pulsación. Nadie debe recibir un golpe por estar a medio escribir `func`.
 * Esta es la diferencia entre un feedback que motiva y uno que agota.
 */
export const DAMAGE_GRACE_MS = 800;

export class RuleDispatcher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastKeystrokeAt = 0;

  constructor(
    private readonly onResults: (results: RuleResult[], phase: ValidationRule['phase']) => void,
  ) {}

  /** Llamar en cada cambio del buffer. */
  scheduleTypeCheck(
    rules: (ValidationRule & { message: string })[],
    getContext: () => EvaluationContext,
  ) {
    this.lastKeystrokeAt = Date.now();
    if (this.timer) clearTimeout(this.timer);

    this.timer = setTimeout(() => {
      const results = evaluateRules(rules, getContext(), 'type');

      // El daño solo se muestra si el usuario ha dejado de escribir.
      const quietFor = Date.now() - this.lastKeystrokeAt;
      const visible =
        quietFor >= DAMAGE_GRACE_MS
          ? results
          : results.filter((result) => result.severity !== 'damage');

      this.onResults(visible, 'type');
    }, TYPE_DEBOUNCE_MS);
  }

  /** Tras `runner.run()`, cuando ya hay salida y DOM. */
  checkAfterRun(
    rules: (ValidationRule & { message: string })[],
    context: EvaluationContext,
  ): RuleResult[] {
    const results = evaluateRules(rules, context, 'run');
    this.onResults(results, 'run');
    return results;
  }

  /** Al pulsar «Validar paso»: se evalúa todo, sin filtrar por fase. */
  checkSubmit(
    rules: (ValidationRule & { message: string })[],
    context: EvaluationContext,
  ): RuleResult[] {
    const results = evaluateRules(rules, context);
    this.onResults(results, 'submit');
    return results;
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
