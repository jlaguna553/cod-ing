'use client';

import { useLessonStore, type LocalizedLesson } from '@/stores/useLessonStore';

/**
 * Puente servidor → store. No renderiza nada y **no se suscribe a nada**.
 *
 * Esa segunda parte no es un detalle de estilo: este componente escribe en el
 * store durante su propio render. Si además se suscribiera, cada escritura lo
 * volvería a renderizar y React aborta con «Maximum update depth exceeded».
 * Ocurrió en la Fase 5 al añadirle un `useEffect` que leía `stepIndex`, y la
 * página entera dejó de cargar.
 *
 * Lo que dependa de los cambios del store va en `useEvaluationStore`, que se
 * suscribe desde fuera del árbol de React.
 */
export function LessonBoot({ lesson }: { lesson: LocalizedLesson }) {
  useLessonStore.getState().syncLesson(lesson);
  return null;
}
