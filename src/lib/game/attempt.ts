import { useEvaluationStore } from '@/stores/useEvaluationStore';
import { useLessonStore } from '@/stores/useLessonStore';
import { useRunnerStore } from '@/stores/useRunnerStore';
import { report } from '@/lib/observability/report';

/**
 * Ejecutar y evaluar, en ese orden.
 *
 * Los tres pasos van juntos siempre: volcar el buffer del editor al runner,
 * ejecutar, y solo entonces juzgar. Saltarse el primero evalúa la versión
 * anterior del archivo; saltarse el segundo deja en gris toda regla que mire la
 * salida o el DOM, porque no hay nada que mirar todavía.
 *
 * Vive fuera de los componentes porque lo necesitan dos: «Ejecutar» en el
 * editor —que solo quiere ver el resultado— y «Evaluar» en la tarjeta del reto,
 * que además decide si el paso está superado. La diferencia entre los dos es
 * únicamente la fase, así que es un parámetro y no una copia del código.
 *
 * @param phase `'run'` juzga solo lo que depende de haber ejecutado; sin fase
 *   se juzga todo, que es lo que hace falta para dar un paso por superado.
 */
export async function runAndEvaluate(phase?: 'run') {
  const { files } = useLessonStore.getState();
  const { syncFile, execute } = useRunnerStore.getState();

  await Promise.all(Object.entries(files).map(([path, content]) => syncFile(path, content)));
  await execute();

  const resultados = useEvaluationStore.getState().evaluate(phase);

  /*
   * Solo la evaluación completa cuenta como intento.
   *
   * «Ejecutar» juzga a medias —lo que depende de haber ejecutado— y contarlo
   * llenaría la estadística de intentos que el usuario no considera intentos.
   * De lo que se manda no sale ni una línea de su código: qué lección, qué
   * paso, si lo superó y **qué reglas fallaron por su id**. Con eso se
   * distingue un paso difícil de un enunciado que no se entiende.
   */
  if (phase === undefined) {
    const { lesson, stepIndex } = useLessonStore.getState();
    if (lesson) {
      report({
        kind: 'step-attempt',
        lessonId: lesson.id,
        stepIndex,
        passed: useEvaluationStore.getState().stepPassed,
        failedRuleIds: resultados
          .filter((resultado) => !resultado.passed)
          .map((resultado) => resultado.ruleId)
          .slice(0, 12),
      });
    }
  }

  return resultados;
}
