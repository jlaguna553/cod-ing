import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  comentariosDe,
  pareceCastellano,
  sinComentarios,
  tieneProsa,
} from '@/lib/content/comentarios';
import { LessonSchema } from '@/lib/content/lesson.schema';
import { codigoDe } from '@/lib/content/localize';

/**
 * El código de las lecciones, también bilingüe.
 *
 * Durante ocho fases el enunciado estaba traducido y el archivo que el alumno
 * tiene delante no: un `// Paso 1: …` en castellano para todo el mundo. Lo que
 * cierra el agujero es una comprobación en `validate-content.ts`, y lo que
 * hace fiable esa comprobación es saber qué trozo de un archivo es prosa.
 * Aquí se prueba justo eso, incluidos los casos donde equivocarse es fácil:
 * un `#` de color no es un comentario y un `//` de una URL tampoco.
 */

test('⭐ reconoce el estilo de comentario de cada lenguaje', () => {
  assert.deepEqual(comentariosDe('main.js', 'const a = 1; // suma\n'), ['// suma']);
  assert.deepEqual(comentariosDe('estilos.css', '.a { /* centra */ }'), ['/* centra */']);
  assert.deepEqual(comentariosDe('index.html', '<p></p><!-- pinta algo -->'), [
    '<!-- pinta algo -->',
  ]);
  assert.deepEqual(comentariosDe('consulta.sql', 'SELECT 1; -- cuenta las filas'), [
    '-- cuenta las filas',
  ]);
  assert.deepEqual(comentariosDe('Dockerfile', 'FROM node\n# la receta\n'), ['# la receta']);
});

test('⭐ lo que parece un comentario y no lo es', () => {
  // Un color de CSS no es un comentario de almohadilla.
  assert.deepEqual(comentariosDe('estilos.css', '.a { color: #94a3b8; }'), []);
  // Ni el `//` de una URL.
  assert.deepEqual(comentariosDe('main.js', "fetch('https://ejemplo.com/api');"), []);
  // Ni un `--flag` pegado, que en SQL exige espacio detrás.
  assert.deepEqual(comentariosDe('Dockerfile', 'RUN npm ci --omit=dev'), []);
  // Un JSON no tiene comentarios que valgan.
  assert.deepEqual(comentariosDe('package.json', '{ "a": "// no" }'), []);
});

test('⭐ una palabra suelta no es prosa; dos ya lo son', () => {
  assert.equal(tieneProsa('main.js', '// TODO\nconst a = 1;'), false);
  assert.equal(tieneProsa('main.js', '// suma dos\nconst a = 1;'), true);
  assert.equal(tieneProsa('main.js', 'const a = 1;'), false);
});

test('⭐ quitar los comentarios deja el mismo código en los dos idiomas', () => {
  const es = "// Paso 1: imprime el saludo\nconsole.log('Hola');\n";
  const en = "// Step 1: print the greeting\nconsole.log('Hola');\n";

  assert.equal(sinComentarios('main.js', es), sinComentarios('main.js', en));
});

test('⭐ un comentario a medio traducir se nota', () => {
  assert.equal(pareceCastellano('// Step 1: print the greeting'), false);
  assert.equal(pareceCastellano('// Paso 1: imprime el saludo'), true);
  // Un identificador en castellano NO cuenta: esos no se traducen.
  assert.equal(pareceCastellano('// returns `nombre` and `usuarios`'), false);
});

/* ── El contenido publicado ──────────────────────────────────────── */

function lecciones() {
  const raiz = path.resolve(import.meta.dirname, '../content/lessons');
  const recorrer = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
      const completa = path.join(dir, entrada.name);
      if (entrada.isDirectory()) return recorrer(completa);
      return entrada.name.endsWith('.lesson.json') ? [completa] : [];
    });

  return recorrer(raiz).map((archivo) =>
    LessonSchema.parse(JSON.parse(readFileSync(archivo, 'utf8'))),
  );
}

test('⭐ ninguna lección enseña código con prosa en un solo idioma', () => {
  const culpables: string[] = [];

  for (const leccion of lecciones()) {
    const archivos = [
      ...leccion.workspace.files,
      ...leccion.steps.flatMap((paso) => paso.solution ?? []),
      ...(leccion.solution?.files ?? []),
    ];

    for (const archivo of archivos) {
      if (typeof archivo.content !== 'string') continue;
      if (tieneProsa(archivo.path, archivo.content)) {
        culpables.push(`${leccion.id} · ${archivo.path}`);
      }
    }
  }

  assert.deepEqual(culpables, [], 'código con comentarios y sin traducir');
});

test('⭐ entre los dos idiomas solo cambian los comentarios', () => {
  const divergentes: string[] = [];

  for (const leccion of lecciones()) {
    const archivos = [
      ...leccion.workspace.files,
      ...leccion.steps.flatMap((paso) => paso.solution ?? []),
      ...(leccion.solution?.files ?? []),
    ];

    for (const archivo of archivos) {
      if (typeof archivo.content === 'string') continue;

      const es = sinComentarios(archivo.path, codigoDe(archivo.content, 'es'));
      const en = sinComentarios(archivo.path, codigoDe(archivo.content, 'en'));
      if (es !== en) divergentes.push(`${leccion.id} · ${archivo.path}`);
    }
  }

  assert.deepEqual(divergentes, [], 'la traducción cambió código, no solo prosa');
});
