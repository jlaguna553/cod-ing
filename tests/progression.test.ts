import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrackMap, nextRecommended, type ProgressRow } from '@/lib/content/progression';
import type { LessonSummary } from '@/lib/content/loader';

function lesson(id: string, order: number, prerequisites: string[] = []): LessonSummary {
  return {
    id,
    track: 'frontend',
    module: 'javascript',
    order,
    kind: 'concept',
    difficulty: 'novice',
    estimatedMinutes: 10,
    title: id,
    summary: '',
    prerequisites,
  };
}

const CHAIN = [
  lesson('js-01', 1),
  lesson('js-02', 2, ['js-01']),
  lesson('js-03', 3, ['js-02']),
];

const XP = { 'js-01': 100, 'js-02': 100, 'js-03': 100 };

test('sin progreso, solo la primera lección está disponible', () => {
  const [group] = buildTrackMap(CHAIN, [], XP);

  assert.equal(group.lessons[0].state, 'available');
  assert.equal(group.lessons[1].state, 'locked');
  assert.equal(group.lessons[2].state, 'locked');
  assert.equal(group.completed, 0);
  assert.equal(group.total, 3);
});

test('completar una lección desbloquea la siguiente', () => {
  const progress: ProgressRow[] = [{ lessonId: 'js-01', status: 'completed', xpEarned: 100 }];
  const [group] = buildTrackMap(CHAIN, progress, XP);

  assert.equal(group.lessons[0].state, 'completed');
  assert.equal(group.lessons[1].state, 'available');
  assert.equal(group.lessons[2].state, 'locked', 'la tercera sigue bloqueada');
  assert.equal(group.xpEarned, 100);
});

test('una lección empezada se marca en progreso', () => {
  const progress: ProgressRow[] = [
    { lessonId: 'js-01', status: 'completed', xpEarned: 100 },
    { lessonId: 'js-02', status: 'in-progress', xpEarned: 0 },
  ];
  const [group] = buildTrackMap(CHAIN, progress, XP);
  assert.equal(group.lessons[1].state, 'in-progress');
});

test('⭐ un prerequisito que NO existe no bloquea nada', () => {
  // El backlog del currículo referencia lecciones sin escribir. Si bloquearan,
  // media plataforma sería inaccesible hasta terminar el temario entero.
  const withGhost = [lesson('css-05', 1, ['css-03-que-no-existe'])];
  const [group] = buildTrackMap(withGhost, [], { 'css-05': 100 });

  assert.equal(group.lessons[0].state, 'available');
  assert.deepEqual(group.lessons[0].missingPrerequisites, []);
});

test('las lecciones se agrupan por módulo y se ordenan por `order`', () => {
  const mixed = [
    { ...lesson('css-02', 2), module: 'css' },
    { ...lesson('js-02', 2) },
    { ...lesson('css-01', 1), module: 'css' },
    { ...lesson('js-01', 1) },
  ];
  const groups = buildTrackMap(mixed, [], {});

  const css = groups.find((group) => group.module === 'css')!;
  assert.deepEqual(css.lessons.map((node) => node.lesson.id), ['css-01', 'css-02']);
});

test('la recomendación prioriza lo empezado sobre lo nuevo', () => {
  const progress: ProgressRow[] = [
    { lessonId: 'js-01', status: 'completed', xpEarned: 100 },
    { lessonId: 'js-02', status: 'in-progress', xpEarned: 0 },
  ];
  const groups = buildTrackMap(CHAIN, progress, XP);

  assert.equal(nextRecommended(groups)?.lesson.id, 'js-02');
});

test('sin nada empezado, recomienda la primera disponible', () => {
  const groups = buildTrackMap(CHAIN, [], XP);
  assert.equal(nextRecommended(groups)?.lesson.id, 'js-01');
});

test('con todo completado no hay recomendación', () => {
  const progress: ProgressRow[] = CHAIN.map((item) => ({
    lessonId: item.id,
    status: 'completed' as const,
    xpEarned: 100,
  }));
  const groups = buildTrackMap(CHAIN, progress, XP);
  assert.equal(nextRecommended(groups), null);
});

/* ── Contra el currículo real ────────────────────────────────────── */

test('⭐ el track de frontend es recorrible: hay una lección de entrada', async () => {
  // Sin al menos una lección sin prerequisitos pendientes, nadie podría
  // empezar el track — el fallo más caro posible en un mapa de progresión.
  const { getAllLessons } = await import('@/lib/content/loader');
  const frontend = getAllLessons('es').filter((item) => item.track === 'frontend');

  const groups = buildTrackMap(frontend, [], {});
  const entryPoints = groups.flatMap((group) =>
    group.lessons.filter((node) => node.state === 'available'),
  );

  assert.ok(entryPoints.length > 0, 'frontend no tiene punto de entrada');
});

test('⭐ completar el currículo en orden desbloquea TODAS las lecciones', async () => {
  const { getAllLessons } = await import('@/lib/content/loader');
  const frontend = getAllLessons('es').filter((item) => item.track === 'frontend');

  const completed: ProgressRow[] = [];
  let guard = 0;

  // Simula a un usuario avanzando: siempre la siguiente recomendada.
  while (guard++ < 100) {
    const groups = buildTrackMap(frontend, completed, {});
    const next = nextRecommended(groups);
    if (!next) break;
    completed.push({ lessonId: next.lesson.id, status: 'completed', xpEarned: 0 });
  }

  assert.equal(
    completed.length,
    frontend.length,
    'quedaron lecciones inalcanzables: hay un ciclo o un prerequisito imposible',
  );
});
