import type { LessonSummary } from './loader';

/**
 * Estado de una lección para el mapa de mundos.
 *
 * `locked` merece explicación: una lección se bloquea cuando algún
 * prerequisito **que existe** está sin completar. Los prerequisitos que aún no
 * se han escrito (el backlog del currículo) **no bloquean** — si lo hicieran,
 * media plataforma sería inaccesible hasta terminar el temario entero.
 */
export type LessonState = 'completed' | 'in-progress' | 'available' | 'locked';

export interface LessonNode {
  lesson: LessonSummary;
  state: LessonState;
  xpEarned: number;
  /** Prerequisitos existentes aún sin completar. */
  missingPrerequisites: string[];
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
      row?.status === 'completed'
        ? 'completed'
        : missingPrerequisites.length > 0
          ? 'locked'
          : row
            ? 'in-progress'
            : 'available';

    const node: LessonNode = {
      lesson,
      state,
      xpEarned: row?.xpEarned ?? 0,
      missingPrerequisites,
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
 * Siguiente lección recomendada: la primera disponible o a medias, en orden.
 *
 * Es lo que alimenta el botón «Continuar», y evita que el usuario tenga que
 * recordar por dónde iba.
 */
export function nextRecommended(groups: ModuleGroup[]): LessonNode | null {
  for (const group of groups) {
    const inProgress = group.lessons.find((node) => node.state === 'in-progress');
    if (inProgress) return inProgress;
  }
  for (const group of groups) {
    const available = group.lessons.find((node) => node.state === 'available');
    if (available) return available;
  }
  return null;
}
