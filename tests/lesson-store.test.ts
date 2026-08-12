import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LessonSchema } from '@/lib/content/lesson.schema';
import { localize } from '@/lib/content/localize';
import { useLessonStore, type LocalizedLesson } from '@/stores/useLessonStore';

const LESSON_FILE = path.resolve(
  import.meta.dirname,
  '../content/lessons/frontend/javascript/js-03-array-map.lesson.json',
);

const raw = LessonSchema.parse(JSON.parse(readFileSync(LESSON_FILE, 'utf8')));

/**
 * Réplica del recorte que hace `toClientLesson` en el loader. El loader
 * importa `server-only` y no se puede cargar aquí, así que el test trabaja
 * sobre la misma forma de datos que recibe el navegador.
 */
function asClientLesson(lesson: ReturnType<typeof localize<typeof raw>>): LocalizedLesson {
  const { solution: _solution, ...rest } = lesson;
  return {
    ...rest,
    rules: rest.rules.filter((r) => !r.hidden),
    steps: rest.steps.map((step) => ({
      ...step,
      hints: step.hints.map(({ id, tier, xpPenalty, autoOfferAfterSeconds }) => ({
        id,
        tier,
        xpPenalty,
        autoOfferAfterSeconds,
      })),
    })),
  } as LocalizedLesson;
}

const inSpanish = asClientLesson(localize(raw, 'es'));
const inEnglish = asClientLesson(localize(raw, 'en'));

const store = useLessonStore;

/**
 * Stub de `/api/hint`. El texto de las pistas ya no vive en el cliente, así
 * que revelarlas es una llamada de red; aquí se simula la respuesta del
 * route handler para poder probar la lógica del store aisladamente.
 */
globalThis.fetch = (async (_url: string, init?: RequestInit) => {
  const { hintId } = JSON.parse(String(init?.body ?? '{}'));
  return {
    ok: true,
    status: 200,
    json: async () => ({ text: `texto-de-${hintId}` }),
  } as Response;
}) as typeof fetch;

test.beforeEach(() => {
  store.setState({
    lesson: null,
    files: {},
    activeFile: null,
    stepIndex: 0,
    revealedHints: [],
    hintTexts: {},
    dirtyFiles: [],
  });
});

test('la lección que llega al cliente no lleva solución ni textos de pistas', () => {
  const payload = JSON.stringify(inSpanish);

  // La solución del ejercicio no puede estar en el HTML.
  assert.equal('solution' in inSpanish, false);
  assert.equal(payload.includes('prices.map((price) => price * 1.21)'), false);

  // El texto de la pista de tier 3 es literalmente la respuesta.
  assert.equal(payload.includes('const withTax = prices.map'), false);
  for (const step of inSpanish.steps) {
    for (const hint of step.hints) {
      assert.equal(hint.text, undefined);
      assert.ok(hint.xpPenalty >= 0, 'el coste sí debe viajar: es una decisión informada');
    }
  }
});

test('syncLesson inicializa buffer, archivo activo y textos localizados', () => {
  store.getState().syncLesson(inSpanish);
  const state = store.getState();

  assert.equal(state.lesson?.id, 'js-03-array-map');
  assert.equal(state.activeFile, 'index.js');
  assert.equal(state.stepIndex, 0);
  assert.ok(state.files['index.js'].includes('const prices'));
  assert.equal(state.lesson?.steps[0].title, 'Un array nuevo, no el mismo');
});

test('cambiar de idioma NO reinicia el progreso del usuario (ADR-01)', async () => {
  store.getState().syncLesson(inSpanish);

  // El usuario trabaja: escribe código, avanza y gasta una pista.
  store.getState().updateFile('index.js', 'const withTax = prices.map((p) => p * 1.21);');
  await store.getState().revealHint('h1', 'es');

  const before = store.getState();
  assert.deepEqual(before.dirtyFiles, ['index.js']);

  // Cambio de idioma → el servidor re-renderiza y LessonBoot vuelve a sincronizar.
  store.getState().syncLesson(inEnglish);
  const after = store.getState();

  // Los textos SÍ cambian...
  assert.equal(after.lesson?.steps[0].title, 'A new array, not the same one');
  assert.equal(after.lesson?.summary.startsWith('Learn to transform'), true);

  // ...y el trabajo del usuario NO se toca.
  assert.equal(after.files['index.js'], 'const withTax = prices.map((p) => p * 1.21);');
  assert.deepEqual(after.dirtyFiles, ['index.js']);
  assert.deepEqual(after.revealedHints, ['h1']);
  assert.equal(after.activeFile, 'index.js');
});

test('cambiar a OTRA lección sí reinicia el workspace', async () => {
  store.getState().syncLesson(inSpanish);
  store.getState().updateFile('index.js', 'basura');
  await store.getState().revealHint('h1', 'es');

  const otherLesson = { ...inSpanish, id: 'js-04-filter' };
  store.getState().syncLesson(otherLesson);

  const state = store.getState();
  assert.equal(state.files['index.js'].includes('const prices'), true);
  assert.deepEqual(state.revealedHints, []);
  assert.deepEqual(state.dirtyFiles, []);
});

test('dirtyFiles se limpia al restaurar el contenido original', () => {
  store.getState().syncLesson(inSpanish);
  const original = store.getState().files['index.js'];

  store.getState().updateFile('index.js', 'modificado');
  assert.deepEqual(store.getState().dirtyFiles, ['index.js']);

  store.getState().updateFile('index.js', original);
  assert.deepEqual(store.getState().dirtyFiles, []);
});

test('la navegación de pasos no se sale de rango', () => {
  store.getState().syncLesson(inSpanish);
  const total = store.getState().lesson!.steps.length;

  store.getState().previousStep();
  assert.equal(store.getState().stepIndex, 0);

  for (let i = 0; i < total + 5; i++) store.getState().nextStep();
  assert.equal(store.getState().stepIndex, total - 1);
});

test('revealHint es idempotente: no se cobra dos veces la misma pista', async () => {
  store.getState().syncLesson(inSpanish);
  await store.getState().revealHint('h1', 'es');
  await store.getState().revealHint('h1', 'es');
  assert.deepEqual(store.getState().revealedHints, ['h1']);
});

test('resetWorkspace devuelve los archivos a su estado inicial', () => {
  store.getState().syncLesson(inSpanish);
  store.getState().updateFile('index.js', 'destrozado');
  store.getState().resetWorkspace();

  assert.ok(store.getState().files['index.js'].includes('const prices'));
  assert.deepEqual(store.getState().dirtyFiles, []);
});
