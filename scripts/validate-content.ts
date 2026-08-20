/**
 * Valida TODO el contenido contra el schema. Se ejecuta en CI (`npm run content:check`)
 * y bloquea el merge de una lección malformada o a medio traducir.
 */
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { LessonSchema } from '../src/lib/content/lesson.schema';
import { codigoDe } from '../src/lib/content/localize';
import {
  comentariosDe,
  pareceCastellano,
  sinComentarios,
  tieneProsa,
} from '../src/lib/content/comentarios';
import type { Difficulty, LocalizedText } from '../src/lib/content/types';

const CONTENT_ROOT = path.resolve(import.meta.dirname, '../content/lessons');

async function findLessonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return findLessonFiles(full);
      return entry.name.endsWith('.lesson.json') ? [full] : [];
    }),
  );
  return files.flat();
}

/**
 * Detecta lecciones que regalan su propia solución en el enunciado.
 *
 * Nace de un caso real: una lección explicaba multi-stage pegando el
 * Dockerfile resuelto en el cuerpo del paso. Recortar `solution` del payload
 * no sirve de nada si el texto del paso contiene la respuesta literal.
 *
 * Solo mira `body` / `task` / `bestPractice`. Las pistas quedan fuera a
 * propósito: la de tier 3 SÍ debe poder ser la solución — cuesta XP y se pide
 * al servidor solo cuando el usuario decide gastarla.
 *
 * Y solo se aplica de `adept` en adelante. En `novice`/`apprentice`, enseñar
 * la sintaxis exacta ES la pedagogía correcta: nadie deduce `COPY package*.json`
 * en su primera lección de Docker. A partir de `adept` se espera que el
 * usuario la reconstruya, y dársela hecha convierte el reto en un dictado.
 */
const SPOILER_ENFORCED_FROM: Difficulty[] = ['adept', 'expert', 'interview'];


/**
 * Un paso sin comprobaciones es un paso que no se practica.
 *
 * El editor está ahí para escribir. Un paso que solo dice «lee esto y quédate
 * con la idea» convierte la pantalla en un libro con un editor decorativo al
 * lado, y el usuario pasa al siguiente sin haber tecleado nada — que es justo
 * lo contrario de para lo que existe la plataforma.
 *
 * La regla es dura a propósito: **todo paso debe pedir algo comprobable**. Si
 * un concepto no se puede ejercitar, va dentro del cuerpo de otro paso que sí
 * lo haga, no como paso propio.
 */
function findPassiveSteps(lesson: ReturnType<typeof LessonSchema.parse>): string[] {
  return lesson.steps.filter((step) => step.ruleIds.length === 0).map((step) => step.id);
}

/**
 * Código con prosa dentro y un solo idioma.
 *
 * El archivo que el alumno tiene delante lleva casi siempre la instrucción
 * concreta —«// Paso 1: …»—, y durante ocho fases viajó en castellano para
 * todo el mundo mientras el enunciado de al lado sí estaba traducido. Esto es
 * lo que impide que vuelva a pasar: en cuanto un comentario tiene dos
 * palabras, el contenido tiene que ser `{es, en}`.
 */
function findMonolingualCode(lesson: ReturnType<typeof LessonSchema.parse>): string[] {
  const archivos = [
    ...lesson.workspace.files,
    ...lesson.steps.flatMap((step) => step.solution ?? []),
    ...(lesson.solution?.files ?? []),
  ];

  return archivos
    .filter((file) => typeof file.content === 'string' && tieneProsa(file.path, file.content))
    .map((file) => file.path)
    .filter((path, indice, todas) => todas.indexOf(path) === indice);
}

/**
 * Traducciones que se han llevado por delante algo que no era prosa.
 *
 * Entre los dos idiomas de un archivo solo pueden cambiar los comentarios. Un
 * identificador o un literal traducido «de más» rompería la lección en ese
 * idioma —y contra unas reglas que se escriben una sola vez—, con el agravante
 * de que en castellano seguiría pasando todo.
 */
function findDivergentCode(lesson: ReturnType<typeof LessonSchema.parse>): string[] {
  const archivos = [
    ...lesson.workspace.files,
    ...lesson.steps.flatMap((step) => step.solution ?? []),
    ...(lesson.solution?.files ?? []),
  ];

  return archivos
    .filter((file) => typeof file.content !== 'string')
    .filter(
      (file) =>
        sinComentarios(file.path, codigoDe(file.content, 'es')) !==
        sinComentarios(file.path, codigoDe(file.content, 'en')),
    )
    .map((file) => file.path);
}

/**
 * Comentarios «traducidos» que siguen en castellano.
 *
 * El fallo natural al añadir el segundo idioma es copiar el bloque y traducir
 * media docena de líneas. Se mira solo dentro de los comentarios de la versión
 * inglesa, así que un identificador en castellano —`nombre`, `usuarios`— no
 * cuenta: esos no se traducen a propósito.
 */
function findUntranslated(lesson: ReturnType<typeof LessonSchema.parse>): string[] {
  const archivos = [
    ...lesson.workspace.files,
    ...lesson.steps.flatMap((step) => step.solution ?? []),
    ...(lesson.solution?.files ?? []),
  ];

  return archivos
    .filter((file) => typeof file.content !== 'string')
    .filter((file) =>
      comentariosDe(file.path, codigoDe(file.content, 'en')).some(pareceCastellano),
    )
    .map((file) => file.path);
}

function findSolutionSpoilers(lesson: ReturnType<typeof LessonSchema.parse>): string[] {
  if (!lesson.solution) return [];
  if (!SPOILER_ENFORCED_FROM.includes(lesson.difficulty)) return [];

  // Lo que ya está en el código de partida no es un secreto: el usuario lo
  // tiene delante. Solo cuenta como spoiler lo que la solución AÑADE.
  // En los DOS idiomas: el enunciado en inglés tampoco puede traer el código
  // que resuelve el paso, y desde que el código es bilingüe son textos
  // distintos.
  const lineasDe = (file: { content: string | LocalizedText }) =>
    (['es', 'en'] as const).flatMap((locale) =>
      codigoDe(file.content, locale)
        .split('\n')
        .map((line) => line.trim()),
    );

  const starterLines = new Set(lesson.workspace.files.flatMap(lineasDe));

  /*
   * También cuentan las soluciones por paso: si el enunciado del paso 2 trae
   * literalmente la consulta que resuelve el paso 2, da igual dónde esté
   * guardada esa consulta.
   */
  const solutionFiles = [
    ...lesson.solution.files,
    ...lesson.steps.flatMap((step) => step.solution ?? []),
  ];

  const solutionLines = solutionFiles.flatMap((file) =>
    lineasDe(file)
      .filter((line) => !starterLines.has(line))
      // Líneas cortas o triviales (`}`, `WORKDIR /app`) coinciden por azar.
      // 16 es empírico: `npm ci --omit=dev` (17) es una fuga real y debe
      // entrar; `WORKDIR /app` (13) es ruido idiomático y debe quedar fuera.
      .filter((line) => line.length >= 16),
  );

  const prose = [
    ...lesson.steps.flatMap((step) =>
      [step.body, step.task, step.bestPractice]
        .filter((text): text is NonNullable<typeof text> => Boolean(text))
        .flatMap((text) => [text.es, text.en]),
    ),
    // Los follow-ups se abren con un clic y sin coste: si el enunciado no
    // puede contener la solución, ellos tampoco.
    ...(lesson.interview?.followUps ?? []).flatMap((f) => [f.answer.es, f.answer.en]),
  ];

  const leaked = new Set<string>();
  for (const line of solutionLines) {
    if (prose.some((text) => text.includes(line))) leaked.add(line);
  }
  return [...leaked];
}

/** DFS con marcado de tres estados; devuelve cada ciclo encontrado. */
function findPrerequisiteCycles(lessons: Map<string, string>): string[][] {
  const graph = new Map<string, string[]>();
  for (const [id, file] of lessons) {
    const lesson = LessonSchema.parse(
      JSON.parse(readFileSync(path.resolve(process.cwd(), file), 'utf8')),
    );
    graph.set(id, lesson.prerequisites.filter((p) => lessons.has(p)));
  }

  const state = new Map<string, 'visiting' | 'done'>();
  const cycles: string[][] = [];

  function visit(id: string, trail: string[]) {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      cycles.push([...trail.slice(trail.indexOf(id)), id]);
      return;
    }
    state.set(id, 'visiting');
    for (const next of graph.get(id) ?? []) visit(next, [...trail, id]);
    state.set(id, 'done');
  }

  for (const id of graph.keys()) visit(id, []);
  return cycles;
}

async function main() {
  const files = await findLessonFiles(CONTENT_ROOT);
  const seenIds = new Map<string, string>();
  let failed = 0;

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const parsed = LessonSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));

    if (!parsed.success) {
      failed++;
      console.error(`\n✖ ${rel}`);
      for (const issue of parsed.error.issues) {
        console.error(`    ${issue.path.join('.') || '(root)'}: ${issue.message}`);
      }
      continue;
    }

    const lesson = parsed.data;
    const duplicate = seenIds.get(lesson.id);
    if (duplicate) {
      failed++;
      console.error(`\n✖ ${rel}\n    id duplicado "${lesson.id}" (ya usado en ${duplicate})`);
      continue;
    }
    seenIds.set(lesson.id, rel);

    const spoilers = findSolutionSpoilers(lesson);
    if (spoilers.length > 0) {
      failed++;
      console.error(`\n✖ ${rel}\n    el enunciado contiene la solución literal:`);
      for (const line of spoilers.slice(0, 5)) console.error(`      « ${line} »`);
      if (spoilers.length > 5) console.error(`      … y ${spoilers.length - 5} líneas más`);
      continue;
    }

    const monolingue = findMonolingualCode(lesson);
    if (monolingue.length > 0) {
      failed++;
      console.error(
        `\n✖ ${rel}\n    código con comentarios en un solo idioma ` +
          `(usa { es, en } en \`content\`):`,
      );
      for (const archivo of monolingue) console.error(`      « ${archivo} »`);
      continue;
    }

    const divergente = findDivergentCode(lesson);
    if (divergente.length > 0) {
      failed++;
      console.error(
        `\n✖ ${rel}\n    la traducción cambió el código, no solo los comentarios:`,
      );
      for (const archivo of divergente) console.error(`      « ${archivo} »`);
      continue;
    }

    const sinTraducir = findUntranslated(lesson);
    if (sinTraducir.length > 0) {
      failed++;
      console.error(`\n✖ ${rel}\n    comentarios en castellano dentro de la versión inglesa:`);
      for (const archivo of sinTraducir) console.error(`      « ${archivo} »`);
      continue;
    }

    const passive = findPassiveSteps(lesson);
    if (passive.length > 0) {
      failed++;
      console.error(
        `\n✖ ${rel}\n    pasos sin nada que resolver (el editor se queda de adorno): ` +
          passive.join(', '),
      );
      continue;
    }

    console.log(
      `✔ ${lesson.id.padEnd(24)} ${lesson.track}/${lesson.module}` +
        `  ${lesson.kind}/${lesson.difficulty}` +
        `  ${lesson.steps.length} pasos, ${lesson.drills.length} drills, ${lesson.rules.length} reglas`,
    );
  }

  console.log(`\n${files.length} lecciones · ${failed} con errores`);

  /*
   * Grafo de prerequisitos.
   *
   * Un prerequisito que apunta a una lección inexistente no es un error de
   * formato —el JSON es válido— sino un agujero en el currículo: la lección
   * promete una base que nadie ha escrito. No bloquea el build, porque durante
   * la construcción del temario es normal referenciar lo que viene después.
   * Pero se lista, porque un aviso invisible se convierte en deuda silenciosa.
   */
  const missing = new Map<string, string[]>();
  for (const [id, file] of seenIds) {
    const lesson = LessonSchema.parse(
      JSON.parse(readFileSync(path.resolve(process.cwd(), file), 'utf8')),
    );
    for (const prerequisite of lesson.prerequisites) {
      if (!seenIds.has(prerequisite)) {
        missing.set(prerequisite, [...(missing.get(prerequisite) ?? []), id]);
      }
    }
  }

  if (missing.size > 0) {
    console.log(`\n⚠ ${missing.size} lecciones referenciadas que aún no existen:`);
    for (const [prerequisite, dependents] of [...missing].sort()) {
      console.log(`    ${prerequisite.padEnd(28)} ← requerida por ${dependents.join(', ')}`);
    }
  }

  /* Ciclos: A requiere B y B requiere A dejaría el track sin punto de entrada. */
  const cycles = findPrerequisiteCycles(seenIds);
  if (cycles.length > 0) {
    console.error(`\n✖ ciclos en el grafo de prerequisitos:`);
    for (const cycle of cycles) console.error(`    ${cycle.join(' → ')}`);
    failed += cycles.length;
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
