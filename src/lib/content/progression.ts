import type { LessonSummary } from './loader';

/**
 * Estado de una lección para el mapa de mundos.
 *
 * **Ninguna lección se bloquea.** Quien llega sabiendo que quiere practicar
 * React entra por React, aunque no haya tocado JavaScript aquí — puede venir
 * de otro sitio, o querer refrescar solo una cosa. Cerrarle la puerta para
 * proteger un orden que quizá ya cumple es la forma más rápida de que se vaya.
 *
 * Lo que sí se hace es **avisar**: `recommendedFirst` lleva los títulos de las
 * lecciones previas que aún no ha completado, para que la decisión sea suya y
 * esté informada. Era un `state: 'locked'` que además quitaba el enlace.
 */
export type LessonState = 'completed' | 'in-progress' | 'available';

export interface LessonNode {
  lesson: LessonSummary;
  state: LessonState;
  xpEarned: number;
  /** Prerequisitos existentes aún sin completar. */
  missingPrerequisites: string[];
  /** Títulos de esos prerequisitos, para poder nombrarlos en el aviso. */
  recommendedFirst: string[];
}

export interface ModuleGroup {
  module: string;
  lessons: LessonNode[];
  completed: number;
  total: number;
  xpEarned: number;
  xpAvailable: number;
}

export interface ProgressRow {
  lessonId: string;
  status: 'in-progress' | 'completed';
  xpEarned: number;
}

/** Agrupa las lecciones de un track por módulo, con su estado. */
export function buildTrackMap(
  lessons: LessonSummary[],
  progress: ProgressRow[],
  xpByLesson: Record<string, number>,
): ModuleGroup[] {
  const byId = new Map(progress.map((row) => [row.lessonId, row]));
  const existing = new Set(lessons.map((lesson) => lesson.id));
  const titleById = new Map(lessons.map((lesson) => [lesson.id, lesson.title]));
  const completed = new Set(
    progress.filter((row) => row.status === 'completed').map((row) => row.lessonId),
  );

  const groups = new Map<string, LessonNode[]>();

  for (const lesson of [...lessons].sort((a, b) => a.order - b.order)) {
    const row = byId.get(lesson.id);

    // Solo cuentan los prerequisitos que existen de verdad.
    const missingPrerequisites = lesson.prerequisites.filter(
      (id) => existing.has(id) && !completed.has(id),
    );

    const state: LessonState =
      row?.status === 'completed' ? 'completed' : row ? 'in-progress' : 'available';

    const node: LessonNode = {
      lesson,
      state,
      xpEarned: row?.xpEarned ?? 0,
      missingPrerequisites,
      recommendedFirst: missingPrerequisites.map((id) => titleById.get(id) ?? id),
    };

    groups.set(lesson.module, [...(groups.get(lesson.module) ?? []), node]);
  }

  return [...groups.entries()].map(([module, nodes]) => ({
    module,
    lessons: nodes,
    completed: nodes.filter((node) => node.state === 'completed').length,
    total: nodes.length,
    xpEarned: nodes.reduce((sum, node) => sum + node.xpEarned, 0),
    xpAvailable: nodes.reduce((sum, node) => sum + (xpByLesson[node.lesson.id] ?? 0), 0),
  }));
}

/**
 * Siguiente lección recomendada: la primera a medias, o la primera disponible
 * cuyos prerequisitos estén cumplidos.
 *
 * Es lo que alimenta el botón «Continuar». Que el mapa no bloquee nada no
 * significa que este botón deba mandarte al medio del temario: recomendar sigue
 * siendo su trabajo, elegir sigue siendo el del usuario.
 */
export function nextRecommended(groups: ModuleGroup[]): LessonNode | null {
  for (const group of groups) {
    const inProgress = group.lessons.find((node) => node.state === 'in-progress');
    if (inProgress) return inProgress;
  }
  for (const group of groups) {
    const ready = group.lessons.find(
      (node) => node.state === 'available' && node.missingPrerequisites.length === 0,
    );
    if (ready) return ready;
  }
  // Todo lo disponible tiene algún hueco detrás: se ofrece igualmente lo
  // primero, que es mejor que no ofrecer nada.
  for (const group of groups) {
    const available = group.lessons.find((node) => node.state === 'available');
    if (available) return available;
  }
  return null;
}
