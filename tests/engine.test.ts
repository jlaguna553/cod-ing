import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LessonSchema } from '@/lib/content/lesson.schema';
import { localize } from '@/lib/content/localize';
import type { Lesson, ValidationRule } from '@/lib/content/types';
import { emptyContext, evaluateRule, isImplemented } from '@/lib/engine';
import { Shell, VirtualFs } from '@/lib/runners/cli-sim';

/* ── Validadores, uno a uno ──────────────────────────────────────── */

function run(rule: Partial<ValidationRule> & { kind: ValidationRule['kind'] }, context: Parameters<typeof evaluateRule>[1]) {
  const full = {
    id: 'r', phase: 'submit', severity: 'error', points: 10, hidden: false,
    message: 'msg', ...rule,
  } as ValidationRule & { message: string };
  return evaluateRule(full, context);
}

test('regex-must falla si el archivo no existe', () => {
  const result = run(
    { kind: 'regex-must', file: 'a.js', pattern: 'x', flags: 'm' },
    emptyContext(),
  );
  assert.equal(result?.passed, false);
  assert.match(result?.detail?.actual ?? '', /no existe/);
});

test('regex-forbid pasa si el archivo no existe: no hay nada prohibido dentro', () => {
  const result = run(
    { kind: 'regex-forbid', file: 'a.js', pattern: 'var ', flags: 'm' },
    emptyContext(),
  );
  assert.equal(result?.passed, true);
});

test('regex-forbid señala la línea del incumplimiento', () => {
  const result = run(
    { kind: 'regex-forbid', file: 'a.js', pattern: '\\bvar\\b', flags: 'm' },
    emptyContext({ files: { 'a.js': 'const a = 1;\nlet b = 2;\nvar c = 3;' } }),
  );
  assert.equal(result?.passed, false);
  assert.equal(result?.location?.line, 3);
});

test('un patrón inválido en el contenido no tumba la evaluación', () => {
  const result = run(
    { kind: 'regex-must', file: 'a.js', pattern: '([', flags: 'm' },
    emptyContext({ files: { 'a.js': 'x' } }),
  );
  assert.equal(result?.passed, false);
});

test('stdout-match compara también el código de salida', () => {
  const context = emptyContext({ stdout: 'Hola, Ada', exitCode: 1, hasRun: true });
  const result = run({ kind: 'stdout-match', equals: 'Hola, Ada', expectExitCode: 0 }, context);
  assert.equal(result?.passed, false);
  assert.match(result?.detail?.expected ?? '', /código de salida/);
});

test('stdout-match acepta regex sobre varias líneas', () => {
  const context = emptyContext({ stdout: '12.1\n30.25\n48.4\n6.05', hasRun: true });
  const result = run(
    { kind: 'stdout-match', matches: '12\\.1.*30\\.25.*48\\.4.*6\\.05', expectExitCode: 0 },
    context,
  );
  assert.equal(result?.passed, true);
});

test('⭐ stdout-match queda PENDIENTE si no se ha ejecutado nada', () => {
  // Validar el paso sin haber pulsado «Ejecutar» no puede marcar en rojo una
  // salida que el usuario todavía no ha tenido ocasión de producir.
  const result = run(
    { kind: 'stdout-match', equals: 'Hola, Ada', expectExitCode: 0 },
    emptyContext({ hasRun: false }),
  );
  assert.equal(result, null, 'sin ejecución no hay veredicto, solo pendiente');
});

test('file-exists reconoce directorios', () => {
  const context = emptyContext({ files: { 'app/src/main.jsx': 'x' } });
  assert.equal(run({ kind: 'file-exists', file: 'app/src/main.jsx' }, context)?.passed, true);
  assert.equal(run({ kind: 'file-exists', file: 'app/src' }, context)?.passed, true);
  assert.equal(run({ kind: 'file-exists', file: 'otro' }, context)?.passed, false);
});

test('cli-transcript exige orden y admite comandos intercalados', () => {
  const context = emptyContext({
    transcript: ['npm create vite@latest app', 'ls', 'cd app', 'npm install'],
  });

  assert.equal(
    run({ kind: 'cli-transcript', expectedCommands: ['npm create vite', 'npm install'], allowExtra: true }, context)?.passed,
    true,
  );
  // Orden invertido: no se cumple.
  assert.equal(
    run({ kind: 'cli-transcript', expectedCommands: ['npm install', 'npm create vite'], allowExtra: true }, context)?.passed,
    false,
  );
});

test('cli-transcript compara por prefijo: las banderas no importan', () => {
  const context = emptyContext({ transcript: ['docker build -t api .'] });
  assert.equal(
    run({ kind: 'cli-transcript', expectedCommands: ['docker build'], allowExtra: true }, context)?.passed,
    true,
  );
});

/* ── AST ─────────────────────────────────────────────────────────── */

test('ast-query no se deja engañar por comentarios ni strings', () => {
  const context = emptyContext({
    files: { 'a.js': '// const x = prices.map(f)\nconst s = "prices.map(f)";' },
  });
  const result = run(
    { kind: 'ast-query', file: 'a.js', query: 'CallExpression[callee.property.name="map"]', minMatches: 1 },
    context,
  );
  assert.equal(result?.passed, false, 'ni el comentario ni el string cuentan como código');
});

test('ast-query encuentra la llamada real', () => {
  const context = emptyContext({ files: { 'a.js': 'const t = prices.map((p) => p * 1.21);' } });
  const result = run(
    { kind: 'ast-query', file: 'a.js', query: 'CallExpression[callee.property.name="map"]', minMatches: 1 },
    context,
  );
  assert.equal(result?.passed, true);
});

test('ast-query cuenta con maxMatches (un solo listener)', () => {
  const one = emptyContext({ files: { 'a.js': 'el.addEventListener("click", f);' } });
  const two = emptyContext({
    files: { 'a.js': 'el.addEventListener("click", f);\nb.addEventListener("click", g);' },
  });
  const rule = {
    kind: 'ast-query' as const,
    file: 'a.js',
    query: 'CallExpression[callee.property.name="addEventListener"]',
    minMatches: 1,
    maxMatches: 1,
  };

  assert.equal(run(rule, one)?.passed, true);
  assert.equal(run(rule, two)?.passed, false);
});

test('ast-query queda PENDIENTE con código a medio escribir, no en rojo', () => {
  // Paréntesis sin cerrar: el estado real del buffer mientras se teclea.
  // (`prices.ma` a secas SÍ es JavaScript válido, así que no serviría de caso.)
  const context = emptyContext({ files: { 'a.js': 'const x = prices.map((p) => ' } });
  const result = run(
    { kind: 'ast-query', file: 'a.js', query: 'CallExpression', minMatches: 1 },
    context,
  );
  assert.equal(result, null, 'código incompleto no debe marcarse como fallo');
});

test('ast-query entiende JSX', () => {
  const context = emptyContext({
    files: { 'a.jsx': 'export default function App() { const [n, setN] = useState(0); return <p>{n}</p>; }' },
  });
  const result = run(
    { kind: 'ast-query', file: 'a.jsx', query: 'CallExpression[callee.name="useState"]', minMatches: 1 },
    context,
  );
  assert.equal(result?.passed, true);
});

/* ── dockerfile-lint ─────────────────────────────────────────────── */

const BROKEN = `FROM node:latest
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
ENV API_KEY=sk-live-8f3a2b91c4
CMD ["node", "dist/server.js"]
`;

const FIXED = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER node
CMD ["node", "dist/server.js"]
`;

function lint(rules: string[], dockerfile: string, extra: Record<string, string> = {}) {
  return run(
    { kind: 'dockerfile-lint', file: 'Dockerfile', rules: rules as never },
    emptyContext({ files: { Dockerfile: dockerfile, ...extra } }),
  );
}

test('cache-order detecta COPY . . antes de instalar', () => {
  assert.equal(lint(['cache-order'], BROKEN)?.passed, false);
  assert.equal(lint(['cache-order'], FIXED)?.passed, true);
});

test('multi-stage, pinned-base-image, non-root-user y no-secrets', () => {
  assert.equal(lint(['multi-stage'], BROKEN)?.passed, false);
  assert.equal(lint(['multi-stage'], FIXED)?.passed, true);

  assert.equal(lint(['pinned-base-image'], BROKEN)?.passed, false);
  assert.equal(lint(['pinned-base-image'], FIXED)?.passed, true);

  assert.equal(lint(['non-root-user'], BROKEN)?.passed, false);
  assert.equal(lint(['non-root-user'], FIXED)?.passed, true);

  assert.equal(lint(['no-secrets'], BROKEN)?.passed, false);
  assert.equal(lint(['no-secrets'], FIXED)?.passed, true);
});

test('no-secrets no confunde una declaración sin valor con un secreto', () => {
  assert.equal(lint(['no-secrets'], 'FROM node:20\nENV API_KEY\nUSER node\n')?.passed, true);
});

test('has-dockerignore distingue ausente de vacío de correcto', () => {
  assert.equal(lint(['has-dockerignore'], FIXED)?.passed, false);
  assert.equal(lint(['has-dockerignore'], FIXED, { '.dockerignore': '  ' })?.passed, false);
  assert.equal(lint(['has-dockerignore'], FIXED, { '.dockerignore': 'node_modules' })?.passed, true);
});

/* ── ⭐ Test de oro: cada lección contra su propia solución ──────── */

function allLessons(): Lesson[] {
  const root = path.resolve(import.meta.dirname, '../content/lessons');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : entry.name.endsWith('.lesson.json') ? [full] : [];
    });
  return walk(root).map((file) => LessonSchema.parse(JSON.parse(readFileSync(file, 'utf8'))));
}

/** Reglas comprobables sin navegador ni ejecución. */
const STATIC_KINDS = new Set(['regex-must', 'regex-forbid', 'ast-query', 'dockerfile-lint', 'file-exists']);

/**
 * Reconstruye el workspace de un usuario que resolvió la lección entera.
 *
 * Cuando la lección tiene terminal, se ejecutan en una `Shell` los comandos
 * que su regla `cli-transcript` declara como esperados: solo así existen los
 * archivos que genera `npm create vite`. Esto prueba de paso que la
 * transcripción esperada de la lección **es realmente ejecutable**.
 */
function solvedWorkspace(lesson: Lesson): Record<string, string> {
  const files = Object.fromEntries(lesson.workspace.files.map((f) => [f.path, f.content]));

  const transcriptRule = lesson.rules.find((rule) => rule.kind === 'cli-transcript');
  if (lesson.runtime.terminal?.enabled && transcriptRule && transcriptRule.kind === 'cli-transcript') {
    const fs = new VirtualFs(files);
    const shell = new Shell(fs, lesson.runtime.terminal.allowedCommands);

    for (const command of transcriptRule.expectedCommands) {
      const result = shell.execute(command);
      // Si el comando esperado falla, la lección pide algo imposible.
      assert.equal(
        result.exitCode,
        0,
        `[${lesson.id}] el comando esperado "${command}" falla: ${result.stderr}`,
      );
      // Tras crear el proyecto hay que entrar en su carpeta, igual que el usuario.
      if (command.startsWith('npm create')) {
        const target =
          command
            .split(/\s+/)
            .find((arg) => !arg.startsWith('-') && !arg.includes('@') && !['npm', 'create'].includes(arg)) ??
          'app'; // el mismo destino por defecto que usa la shell
        shell.execute(`cd ${target}`);
      }
    }
    Object.assign(files, fs.toRecord());
  }

  for (const file of lesson.solution?.files ?? []) files[file.path] = file.content;
  return files;
}

for (const lesson of allLessons()) {
  const localized = localize(lesson, 'es');
  const staticRules = localized.rules.filter(
    (rule) => STATIC_KINDS.has(rule.kind) && isImplemented(rule.kind),
  );
  if (staticRules.length === 0 || !lesson.solution) continue;

  /*
   * Con un ejercicio por paso, la solución final ya no cumple —ni debe— las
   * reglas de los pasos anteriores. Cada paso que declara `solution` se
   * comprueba contra la suya: sin esto, todas las promesas menos la última se
   * quedan sin verificar.
   */
  for (const [index, step] of localized.steps.entries()) {
    if (!step.solution) continue;

    const stepRules = step.ruleIds
      .map((id) => localized.rules.find((rule) => rule.id === id))
      .filter(
        (rule): rule is NonNullable<typeof rule> =>
          rule !== undefined && STATIC_KINDS.has(rule.kind) && isImplemented(rule.kind),
      );
    if (stepRules.length === 0) continue;

    test(`⭐ ${lesson.id} · paso ${index + 1} (${step.id}): su solución supera sus reglas`, () => {
      const files = solvedWorkspace(lesson);
      for (const file of step.solution ?? []) files[file.path] = file.content;
      const context = emptyContext({ files });

      for (const rule of stepRules) {
        const result = evaluateRule(rule as never, context);
        if (result === null) continue;
        assert.equal(
          result.passed,
          true,
          `[${lesson.id} · ${step.id}] "${rule.id}" falla contra la solución de su paso: ` +
            `esperado ${result.detail?.expected ?? '—'}, obtenido ${result.detail?.actual ?? '—'}`,
        );
      }
    });
  }

  test(`⭐ ${lesson.id}: la solución de referencia supera las reglas de su último paso`, () => {
    // El estado final: código de partida, los comandos que la lección espera
    // que el usuario ejecute, y la solución aplicada encima. Sin ejecutar los
    // comandos, una lección como react-04 nunca tendría el proyecto generado.
    const files = solvedWorkspace(lesson);
    const context = emptyContext({ files });

    /*
     * Solo las reglas del ÚLTIMO paso.
     *
     * Con un ejercicio por paso, `solution` es el estado final y no tiene por
     * qué cumplir las reglas de los pasos anteriores: la consulta del paso 3
     * filtra por otra cosa que la del paso 1. Exigirle todas convertía en
     * error lo que es el diseño. Los pasos intermedios los cubre la
     * comprobación por paso de arriba, contra su propia solución.
     */
    const lastStep = localized.steps.at(-1);
    const applicable = staticRules.filter((rule) => lastStep?.ruleIds.includes(rule.id));

    for (const rule of applicable) {
      const result = evaluateRule(rule as never, context);
      if (result === null) continue;
      assert.equal(
        result.passed,
        true,
        `[${lesson.id}] la regla "${rule.id}" (${rule.kind}) falla contra la propia solución: ` +
          `esperado ${result.detail?.expected ?? '—'}, obtenido ${result.detail?.actual ?? '—'}`,
      );
    }
  });

  test(`⭐ ${lesson.id}: el código de partida NO supera las reglas bloqueantes`, () => {
    const files = Object.fromEntries(lesson.workspace.files.map((f) => [f.path, f.content]));
    const context = emptyContext({ files });

    const blocking = staticRules.filter((rule) => rule.severity === 'error');
    if (blocking.length === 0) return;

    const results = blocking
      .map((rule) => evaluateRule(rule as never, context))
      .filter((result) => result !== null);

    assert.ok(
      results.some((result) => !result!.passed),
      `[${lesson.id}] el ejercicio ya está resuelto de partida: ninguna regla bloqueante falla`,
    );
  });
}
