import { useMemo } from 'react';
import { create } from 'zustand';
import type { RuleResult, ValidationRule } from '@/lib/content/types';
import { emptyContext, evaluateRules, findSyntaxError } from '@/lib/engine';
import { DAMAGE_GRACE_MS, TYPE_DEBOUNCE_MS } from '@/lib/engine/dispatcher';
import { getActiveRunner, getTranscript, useRunnerStore } from './useRunnerStore';
import { useLessonStore } from './useLessonStore';

interface EvaluationState {
  /** Último veredicto por regla. Ausente = pendiente. */
  results: Record<string, RuleResult>;
  /** El paso actual se ha superado. */
  stepPassed: boolean;
  lastCheckedAt: number;
  /**
   * Error de sintaxis del archivo activo, si lo hay.
   *
   * Sin esto, un archivo que no compila deja TODAS las comprobaciones en gris
   * sin decir por qué: el usuario ve cuatro círculos vacíos y no tiene forma de
   * saber que le falta un paréntesis. Es la diferencia entre un evaluador que
   * ayuda y uno que se calla.
   */
  syntaxError: { message: string; line: number; file: string } | null;

  evaluate: (phase?: ValidationRule['phase']) => RuleResult[];
  scheduleTypeCheck: () => void;
  clear: () => void;
}

let typeTimer: ReturnType<typeof setTimeout> | null = null;
let lastKeystrokeAt = 0;

/** Reúne el estado disperso en un contexto de evaluación. */
function buildContext() {
  const lesson = useLessonStore.getState();
  const runner = useRunnerStore.getState();

  const active = getActiveRunner() as { getDocument?: () => Document | null } | null;

  /*
   * La salida se toma de los LOGS acumulados, no de `lastResult.stdout`.
   *
   * El runner resuelve su promesa cuando el documento termina de cargar, pero
   * los `console.log` viajan por `postMessage` y algunos llegan después de ese
   * instante. Síntoma observado: la consola mostraba «Ada 10 cyan» mientras la
   * comprobación de salida seguía en rojo con un stdout vacío.
   *
   * Los logs son la fuente completa; `lastResult` solo aporta el código de
   * salida y el hecho de que se haya llegado a ejecutar.
   */
  const fromLogs = (stream: 'stdout' | 'stderr') =>
    runner.logs
      .filter((log) => log.stream === stream)
      .map((log) => log.text)
      .join('');

  return emptyContext({
    files: { ...lesson.files, ...runner.generatedFiles },
    stdout: fromLogs('stdout') || (runner.lastResult?.stdout ?? ''),
    stderr: fromLogs('stderr') || (runner.lastResult?.stderr ?? ''),
    exitCode: runner.lastResult?.exitCode ?? 0,
    hasRun: runner.lastResult !== null,
    document: active?.getDocument?.() ?? null,
    transcript: getTranscript(),
  });
}

/** Busca un error de sintaxis en el archivo abierto. */
function detectSyntaxError() {
  const { activeFile, files } = useLessonStore.getState();
  if (!activeFile || !/\.(js|jsx|mjs|ts|tsx)$/.test(activeFile)) return null;

  const failure = findSyntaxError(files[activeFile] ?? '');
  return failure ? { ...failure, file: activeFile } : null;
}

/** Reglas del paso actual, ya localizadas por el loader. */
function currentRules(): (ValidationRule & { message: string })[] {
  const { lesson, stepIndex } = useLessonStore.getState();
  const step = lesson?.steps[stepIndex];
  if (!lesson || !step) return [];

  return step.ruleIds
    .map((id) => lesson.rules.find((rule) => rule.id === id))
    .filter((rule): rule is NonNullable<typeof rule> => Boolean(rule)) as never;
}

export const useEvaluationStore = create<EvaluationState>()((set, get) => ({
  results: {},
  stepPassed: false,
  lastCheckedAt: 0,
  syntaxError: null,

  evaluate: (phase) => {
    const rules = currentRules();
    const results = evaluateRules(rules, buildContext(), phase);

    set((state) => {
      // Se fusiona en lugar de reemplazar: una evaluación de fase `type` no
      // debe borrar el veredicto que dio `run` sobre otras reglas.
      const merged = { ...state.results };
      for (const result of results) merged[result.ruleId] = result;

      /*
       * Un paso SIN comprobaciones bloqueantes se da por superado.
       *
       * Los pasos de solo lectura —«predice qué pasaría», «mide el tiempo de
       * build»— no tienen nada que validar. Antes se quedaban eternamente sin
       * superar, y el usuario veía un panel que decía «este paso no tiene
       * comprobaciones» sin ninguna indicación de que podía continuar.
       */
      const blocking = rules.filter((rule) => rule.severity === 'error');
      const stepPassed =
        blocking.length === 0 || blocking.every((rule) => merged[rule.id]?.passed === true);

      return {
        results: merged,
        stepPassed,
        lastCheckedAt: Date.now(),
        syntaxError: detectSyntaxError(),
      };
    });

    return results;
  },

  /**
   * Evaluación mientras se escribe, con dos amortiguadores:
   * el debounce (no parsear en cada tecla) y el margen de gracia del daño
   * (no golpear a alguien por estar a medio escribir una palabra).
   */
  scheduleTypeCheck: () => {
    lastKeystrokeAt = Date.now();
    if (typeTimer) clearTimeout(typeTimer);

    typeTimer = setTimeout(() => {
      const rules = currentRules();
      const results = evaluateRules(rules, buildContext(), 'type');

      const quietFor = Date.now() - lastKeystrokeAt;
      const visible =
        quietFor >= DAMAGE_GRACE_MS
          ? results
          : results.filter((result) => result.severity !== 'damage');

      set((state) => {
        const merged = { ...state.results };
        for (const result of visible) merged[result.ruleId] = result;
        return { results: merged, lastCheckedAt: Date.now(), syntaxError: detectSyntaxError() };
      });
    }, TYPE_DEBOUNCE_MS);
  },

  clear: () => {
    if (typeTimer) clearTimeout(typeTimer);
    set({ results: {}, stepPassed: false, lastCheckedAt: 0, syntaxError: null });
  },
}));

/**
 * Los veredictos pertenecen a UN paso de UNA lección.
 *
 * Se limpian desde una suscripción al store y no desde un `useEffect` en un
 * componente: `LessonBoot` escribe en el store durante su render, así que
 * suscribirlo provocaría un bucle de renders (y lo provocó). Fuera del árbol
 * de React esto es simplemente un callback.
 */
useLessonStore.subscribe((state, previous) => {
  const changedStep = state.stepIndex !== previous.stepIndex;
  const changedLesson = state.lesson?.id !== previous.lesson?.id;
  if (changedStep || changedLesson) useEvaluationStore.getState().clear();
});

/** Reglas del paso con su veredicto, para pintar la lista de pruebas. */
export function useStepChecks() {
  const results = useEvaluationStore((s) => s.results);
  const lesson = useLessonStore((s) => s.lesson);
  const stepIndex = useLessonStore((s) => s.stepIndex);

  // Memoizado: devuelve un array nuevo en cada llamada y se pasa a un
  // componente que lo recorre. Sin `useMemo`, cada render produce una
  // identidad distinta y arrastra re-renders innecesarios.
  return useMemo(() => {
    const step = lesson?.steps[stepIndex];
    if (!lesson || !step) return [];

    return step.ruleIds
      .map((id) => lesson.rules.find((rule) => rule.id === id))
      .filter((rule): rule is NonNullable<typeof rule> => Boolean(rule))
      .filter((rule) => !rule.hidden)
      .map((rule) => ({ rule, result: results[rule.id] ?? null }));
  }, [lesson, stepIndex, results]);
}
