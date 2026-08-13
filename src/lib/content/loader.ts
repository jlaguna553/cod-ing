import 'server-only';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { cache } from 'react';
import { AchievementCatalogSchema, LessonSchema } from './lesson.schema';
import { localize, type Localized } from './localize';
import type {
  Achievement,
  ClientLesson,
  Difficulty,
  Lesson,
  LessonKind,
  Locale,
  Track,
} from './types';

const CONTENT_ROOT = path.join(process.cwd(), 'content', 'lessons');

/** Ficha ligera para listados, mapas de mundo y prerequisitos. */
export interface LessonSummary {
  id: string;
  track: Track;
  module: string;
  order: number;
  kind: LessonKind;
  difficulty: Difficulty;
  estimatedMinutes: number;
  title: string;
  summary: string;
  prerequisites: string[];
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.lesson.json') ? [full] : [];
  });
}

/**
 * Índice `lessonId → ruta de fichero`, construido una vez por proceso.
 *
 * Existe porque la URL es `/play/[track]/[lesson]` y no incluye el módulo:
 * el usuario no debería tener que saber que `docker-07-layer-cache` vive en
 * `devops/docker/`. Reorganizar carpetas no rompe ninguna URL.
 *
 * `cache()` de React lo memoiza por request; el `Map` de módulo lo memoiza
 * durante toda la vida del proceso en producción.
 */
let indexCache: Map<string, string> | null = null;

function getFileIndex(): Map<string, string> {
  if (indexCache) return indexCache;

  const index = new Map<string, string>();
  for (const file of walk(CONTENT_ROOT)) {
    // El id es el nombre del fichero: `docker-07-layer-cache.lesson.json`.
    // `validate-content.ts` ya garantiza en CI que coincide con `lesson.id`
    // y que no hay duplicados, así que aquí no hace falta abrir el JSON.
    const id = path.basename(file, '.lesson.json');
    index.set(id, file);
  }
  indexCache = index;
  return index;
}

/**
 * Lee y VALIDA una lección. La validación no se salta en producción a
 * propósito: es barata comparada con el I/O, y una lección corrupta debe
 * fallar aquí —donde el error es legible— y no dentro de un componente.
 */
export const getLesson = cache((id: string): Lesson | null => {
  const file = getFileIndex().get(id);
  if (!file) return null;

  const parsed = LessonSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    throw new Error(
      `Lección inválida "${id}" (${path.relative(process.cwd(), file)}):\n` +
        parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }
  return parsed.data;
});

/**
 * Lección resuelta a UN idioma y recortada para el cliente.
 *
 * Colapsar `{es, en}` en el servidor tiene dos efectos: el payload que cruza
 * a cliente es la mitad, y ningún componente necesita conocer el locale —
 * reciben strings. Cambiar de idioma vuelve a pedir esta función y el store
 * fusiona el resultado conservando el progreso (ver `useLessonStore`).
 *
 * El recorte (`toClientLesson`) es igual de importante: el payload RSC se
 * serializa en el HTML en texto plano, así que todo lo que pase por aquí es
 * público de facto.
 */
export const getLocalizedLesson = cache(
  (id: string, locale: Locale): ClientLesson | null => {
    const lesson = getLesson(id);
    return lesson ? toClientLesson(localize(lesson, locale)) : null;
  },
);

/** Quita solución, textos de pistas y reglas ocultas. Ver `ClientLesson`. */
function toClientLesson(lesson: Localized<Lesson>): ClientLesson {
  const { solution: _solution, ...rest } = lesson;

  return {
    ...rest,
    // Las reglas ocultas se evalúan en servidor (Fase 4): no viajan nunca.
    rules: rest.rules.filter((rule) => !rule.hidden),
    steps: rest.steps.map(({ solution: _stepSolution, ...step }) => ({
      ...step,
      ruleIds: step.ruleIds.filter((id) =>
        rest.rules.some((rule) => rule.id === id && !rule.hidden),
      ),
      hints: step.hints.map((hint) => ({
        id: hint.id,
        tier: hint.tier,
        xpPenalty: hint.xpPenalty,
        autoOfferAfterSeconds: hint.autoOfferAfterSeconds,
        // `text` deliberadamente ausente → se pide a /api/hint al revelar.
      })),
    })),
  };
}

/** Catálogo de logros, validado y cacheado por proceso. */
export const getAchievements = cache((): Achievement[] => {
  const file = path.join(process.cwd(), 'content', 'achievements', 'achievements.json');
  return AchievementCatalogSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
});

/** Texto de una pista concreta. Solo servidor, vía `/api/hint`. */
export const getHintText = cache(
  (lessonId: string, hintId: string, locale: Locale): string | null => {
    const lesson = getLesson(lessonId);
    if (!lesson) return null;

    for (const step of lesson.steps) {
      const hint = step.hints.find((h) => h.id === hintId);
      if (hint) return hint.text[locale];
    }
    return null;
  },
);

/** Todas las lecciones, ordenadas por track y por `order`. */
export const getAllLessons = cache((locale: Locale): LessonSummary[] =>
  [...getFileIndex().keys()]
    .map((id) => getLesson(id))
    .filter((l): l is Lesson => l !== null)
    .map((l) => ({
      id: l.id,
      track: l.track,
      module: l.module,
      order: l.order,
      kind: l.kind,
      difficulty: l.difficulty,
      estimatedMinutes: l.estimatedMinutes,
      title: l.title[locale],
      summary: l.summary[locale],
      prerequisites: l.prerequisites,
    }))
    .sort((a, b) => a.track.localeCompare(b.track) || a.order - b.order),
);

/** Para `generateStaticParams`: prerenderiza cada lección en cada idioma. */
export function getLessonRouteParams(): { track: Track; lesson: string }[] {
  return [...getFileIndex().keys()]
    .map((id) => getLesson(id))
    .filter((l): l is Lesson => l !== null)
    .map((l) => ({ track: l.track, lesson: l.id }));
}

/** Siguiente lección del mismo módulo, para el botón de continuar. */
export const getNextLessonId = cache((id: string): string | null => {
  const current = getLesson(id);
  if (!current) return null;

  const siblings = [...getFileIndex().keys()]
    .map((lessonId) => getLesson(lessonId))
    .filter((l): l is Lesson => l !== null && l.module === current.module)
    .sort((a, b) => a.order - b.order);

  const position = siblings.findIndex((l) => l.id === id);
  return siblings[position + 1]?.id ?? null;
});

/**
 * Cuántas lecciones tiene cada módulo.
 *
 * Lo necesita el servidor para decidir si un módulo está completo: es un dato
 * que solo él conoce, y por eso el logro «módulo completado» no puede
 * concederse desde el cliente.
 */
export const getModuleSizes = cache((): Record<string, number> => {
  const sizes: Record<string, number> = {};
  for (const id of getFileIndex().keys()) {
    const lesson = getLesson(id);
    if (!lesson) continue;
    sizes[lesson.module] = (sizes[lesson.module] ?? 0) + 1;
  }
  return sizes;
});
