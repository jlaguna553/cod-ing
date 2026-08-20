import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { assembleDocument } from '@/lib/runners/dom';
import { LessonSchema } from '@/lib/content/lesson.schema';
import { codigoDe } from '@/lib/content/localize';

test('inyecta el CSS del workspace en lugar del <link>', () => {
  const document = assembleDocument(
    {
      'index.html': '<!doctype html><html><head><link rel="stylesheet" href="./styles.css" /></head><body></body></html>',
      'styles.css': '.card { color: red; }',
    },
    1,
  );

  assert.ok(document.includes('<style>'), 'debe haber una etiqueta style');
  assert.ok(document.includes('.card { color: red; }'));
  assert.equal(document.includes('<link'), false, 'el link no puede sobrevivir');
});

test('inyecta el JS del workspace como módulo', () => {
  const document = assembleDocument(
    {
      'index.html': '<!doctype html><html><body><script type="module" src="./app.js"></script></body></html>',
      'app.js': 'console.log("hola");',
    },
    1,
  );

  assert.ok(document.includes('console.log("hola")'));
  assert.ok(document.includes('type="module"'));
  assert.equal(document.includes('src="./app.js"'), false);
});

test('resuelve rutas con y sin ./', () => {
  const withDot = assembleDocument(
    { 'index.html': '<html><body><script src="./a.js"></script></body></html>', 'a.js': 'X' },
    1,
  );
  const withoutDot = assembleDocument(
    { 'index.html': '<html><body><script src="a.js"></script></body></html>', 'a.js': 'X' },
    1,
  );

  assert.ok(withDot.includes('X'));
  assert.ok(withoutDot.includes('X'));
});

test('deja intacta la etiqueta si el archivo no existe en el workspace', () => {
  const document = assembleDocument(
    { 'index.html': '<html><head><link rel="stylesheet" href="https://cdn.example/x.css" /></head></html>' },
    1,
  );
  assert.ok(document.includes('cdn.example'), 'un recurso externo no se toca');
});

test('el puente de consola lleva el token de la sesión', () => {
  const first = assembleDocument({ 'index.html': '<html><head></head></html>' }, 7);
  assert.ok(first.includes('var TOKEN = 7;'));
  assert.ok(first.includes('postMessage'));
});

test('el puente entra antes del contenido para capturar errores de parseo', () => {
  const document = assembleDocument(
    { 'index.html': '<html><head><title>t</title></head><body><script>boom()</script></body></html>' },
    1,
  );
  assert.ok(document.indexOf('TOKEN') < document.indexOf('boom()'));
});

test('funciona sin index.html: genera un documento mínimo', () => {
  const document = assembleDocument({ 'index.js': 'console.log(1);' }, 1);
  assert.ok(document.includes('<html'));
  assert.ok(document.includes('TOKEN'));
  assert.ok(document.includes('console.log(1)'), 'el código debe ejecutarse');
});

/* ── Contra el contenido real ────────────────────────────────────── */

const DOM_LESSONS = [
  'frontend/javascript/js-06-dom-manipulation',
  'frontend/javascript/js-08-event-listeners',
  'frontend/css/css-05-flexbox-centering',
  'frontend/html/html-02-semantic-structure',
];

test('las lecciones `dom` reales se ensamblan con su código de partida dentro', () => {
  for (const slug of DOM_LESSONS) {
    const file = path.resolve(
      import.meta.dirname,
      `../content/lessons/${slug}.lesson.json`,
    );
    const lesson = LessonSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    assert.equal(lesson.runtime.kind, 'dom', `${lesson.id} debería usar el runner de DOM`);

    const files = Object.fromEntries(
      lesson.workspace.files.map((entry) => [entry.path, codigoDe(entry.content)]),
    );
    const document = assembleDocument(files, 1);

    // Todo archivo .css/.js del workspace referenciado desde el HTML debe
    // acabar embebido: si no, la lección se vería en blanco al ejecutar.
    for (const entry of lesson.workspace.files) {
      if (!/\.(css|js)$/.test(entry.path)) continue;
      if (!files['index.html']?.includes(entry.path.replace(/^\.\//, ''))) continue;

      const firstLine = codigoDe(entry.content).split('\n').find((line) => line.trim().length > 12);
      if (firstLine) {
        assert.ok(
          document.includes(firstLine.trim()),
          `${lesson.id}: ${entry.path} no quedó embebido en el documento`,
        );
      }
    }
  }
});

/* ── Lecciones sin index.html ────────────────────────────────────── */

test('⭐ una lección con solo un .js genera su documento y ejecuta el código', () => {
  // `js-01` y `js-02` son así. Sin esto, no había ningún `<script src>` que
  // sustituir: el documento salía vacío y el código NUNCA se ejecutaba.
  const document = assembleDocument(
    { 'index.js': "console.log('Ada 10 cyan');" },
    1,
    'index.js',
  );

  assert.ok(document.includes("console.log('Ada 10 cyan')"), 'el código debe quedar embebido');
  assert.ok(document.includes('type="module"'));
  assert.ok(document.includes('TOKEN'), 'el puente de consola debe estar presente');
});

test('el archivo `entry` se inyecta el último: suele consumir a los demás', () => {
  const document = assembleDocument(
    { 'helper.js': 'export const x = 1;', 'main.js': 'import { x } from "./helper.js";' },
    1,
    'main.js',
  );
  assert.ok(document.indexOf('export const x') < document.indexOf('import { x }'));
});

test('los .css del workspace se embeben aunque no haya index.html', () => {
  const document = assembleDocument(
    { 'styles.css': '.card { color: red; }', 'index.js': 'console.log(1);' },
    1,
    'index.js',
  );
  assert.ok(document.includes('.card { color: red; }'));
  assert.equal(document.includes('<link'), false);
});

test('⭐ TODAS las lecciones `dom` acaban con su código en el documento', () => {
  const root = path.resolve(import.meta.dirname, '../content/lessons');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : entry.name.endsWith('.lesson.json') ? [full] : [];
    });

  for (const file of walk(root)) {
    const lesson = LessonSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    if (lesson.runtime.kind !== 'dom') continue;

    const files = Object.fromEntries(
      lesson.workspace.files.map((entry) => [entry.path, codigoDe(entry.content)]),
    );
    const document = assembleDocument(files, 1, lesson.workspace.entry);

    const entryContent = files[lesson.workspace.entry];
    if (!entryContent || !/\.(js|css)$/.test(lesson.workspace.entry)) continue;

    const firstLine = entryContent
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 12 && !line.startsWith('//'));

    if (firstLine) {
      assert.ok(
        document.includes(firstLine),
        `${lesson.id}: el contenido de ${lesson.workspace.entry} no llega al documento`,
      );
    }
  }
});
