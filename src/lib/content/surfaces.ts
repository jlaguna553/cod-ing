import type { ClientLesson } from './types';

/**
 * Qué superficies de salida tienen sentido para una lección.
 *
 * Nace de un problema concreto: `js-01` abría siempre en la pestaña de vista
 * previa, que para una lección de variables es un rectángulo blanco vacío. El
 * usuario ejecutaba, no veía nada y tenía que descubrir por su cuenta que su
 * salida estaba en otra pestaña.
 *
 * La regla es que **una herramienta que no se usa no se enseña**. Se calcula
 * a partir de lo que la lección declara, no de una lista mantenida a mano:
 * añadir una lección nueva no obliga a tocar este archivo.
 */
export interface Surfaces {
  preview: boolean;
  console: boolean;
  terminal: boolean;
}

/**
 * Extensiones que producen algo que mirar.
 *
 * `.html` NO está en la lista a propósito. En varias lecciones de JavaScript
 * el `index.html` es solo un anfitrión para el `<script>` —un documento con un
 * contenedor vacío— y contarlo como visual devolvía a `js-03` la vista previa
 * en blanco que este módulo viene a quitar. Una lección de HTML se reconoce
 * por lo que **comprueba** (`dom-assert`), no por tener un archivo `.html`.
 */
const VISUAL_FILE = /\.(css|vue|svelte|jsx|tsx)$/i;

export function surfacesFor(lesson: ClientLesson): Surfaces {
  const kind = lesson.runtime.kind;

  /*
   * SQL tiene su propia superficie: una rejilla de resultados. La consola se
   * mantiene porque el error de Postgres sí es texto —y leerlo es parte de la
   * lección—, pero lo que se mira al ejecutar es la tabla.
   */
  if (kind === 'sql') return { preview: true, console: true, terminal: false };

  /*
   * En `cli-sim` la terminal ES la salida: no hay proceso aparte que imprima
   * por consola, así que ofrecer las dos sería ofrecer la misma cosa dos veces.
   */
  const terminalOnlyRuntime = kind === 'cli-sim';
  const terminal = terminalOnlyRuntime || lesson.runtime.terminal?.enabled === true;

  const preview =
    !terminalOnlyRuntime &&
    // Sandpack monta una aplicación: siempre hay algo que ver.
    (kind === 'sandpack' ||
      lesson.workspace.files.some((file) => VISUAL_FILE.test(file.path)) ||
      lesson.rules.some((rule) => rule.kind === 'dom-assert'));

  return { preview, console: !terminalOnlyRuntime, terminal };
}

/** Superficie que conviene mostrar al abrir la lección. */
export function defaultSurface(surfaces: Surfaces): 'preview' | 'console' | 'terminal' {
  if (surfaces.terminal && !surfaces.preview) return 'terminal';
  if (surfaces.preview) return 'preview';
  return 'console';
}

/** `true` si hay más de una superficie: sin eso, las pestañas sobran. */
export function needsTabs(surfaces: Surfaces): boolean {
  return [surfaces.preview, surfaces.console, surfaces.terminal].filter(Boolean).length > 1;
}
