import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LessonSchema } from '@/lib/content/lesson.schema';
import { localize } from '@/lib/content/localize';
import type { ClientLesson } from '@/lib/content/types';
import { defaultSurface, needsTabs, surfacesFor } from '@/lib/content/surfaces';

/**
 * Qué herramientas ofrece cada lección.
 *
 * Se fija aquí, y no a ojo en el navegador, porque el fallo que arregla es
 * silencioso: `js-01` abría en una vista previa en blanco y nadie se daba
 * cuenta de que su salida estaba en otra pestaña. Una lección nueva que
 * calcule mal sus superficies rompe este test antes de llegar a producción.
 */

function allLessons(): ClientLesson[] {
  const root = path.resolve(import.meta.dirname, '../content/lessons');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : entry.name.endsWith('.lesson.json') ? [full] : [];
    });

  return walk(root).map((file) => {
    const parsed = LessonSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    const { solution: _solution, ...rest } = localize(parsed, 'es');
    return rest as unknown as ClientLesson;
  });
}

const lessons = new Map(allLessons().map((lesson) => [lesson.id, lesson]));

function surfaces(id: string) {
  const lesson = lessons.get(id);
  assert.ok(lesson, `la lección ${id} no existe`);
  return surfacesFor(lesson);
}

test('una lección de solo consola no ofrece vista previa', () => {
  /*
   * `js-03` sí trae un `index.html`, pero es el anfitrión del `<script>`: un
   * documento con un `<ul>` vacío que la lección nunca llena. Contarlo como
   * visual devolvería la vista previa en blanco, así que la decisión se toma
   * por lo que la lección comprueba, no por su lista de archivos.
   */
  for (const id of ['js-01-variables', 'js-02-functions', 'js-03-array-map']) {
    const result = surfaces(id);
    assert.equal(result.preview, false, `${id} no debería ofrecer vista previa`);
    assert.equal(result.console, true);
    assert.equal(defaultSurface(result), 'console');
    assert.equal(needsTabs(result), false, `${id} no necesita pestañas`);
  }
});

test('una lección con HTML o CSS abre en la vista previa', () => {
  for (const id of ['html-01-first-page', 'html-02-semantic-structure', 'css-03-box-model']) {
    const result = surfaces(id);
    assert.equal(result.preview, true, `${id} debería ofrecer vista previa`);
    assert.equal(defaultSurface(result), 'preview');
  }
});

test('una lección de DOM sin HTML propio se apoya en sus reglas dom-assert', () => {
  const result = surfaces('js-06-dom-manipulation');
  assert.equal(result.preview, true);
});

test('las lecciones de terminal no ofrecen consola aparte', () => {
  // En `cli-sim` la terminal ES la salida: dos pestañas mostrarían lo mismo.
  for (const id of [
    'docker-03-dockerfile-basics',
    'docker-05-images-layers',
    'docker-07-layer-cache',
  ]) {
    const result = surfaces(id);
    assert.deepEqual(result, { preview: false, console: false, terminal: true });
    assert.equal(defaultSurface(result), 'terminal');
    assert.equal(needsTabs(result), false);
  }
});

test('Sandpack con terminal ofrece las tres superficies', () => {
  const result = surfaces('react-04-state-and-events');
  assert.deepEqual(result, { preview: true, console: true, terminal: true });
  assert.equal(needsTabs(result), true);
});

test('ninguna lección se queda sin ninguna superficie', () => {
  for (const lesson of lessons.values()) {
    const result = surfacesFor(lesson);
    assert.ok(
      result.preview || result.console || result.terminal,
      `${lesson.id} no ofrece ninguna salida`,
    );
  }
});
