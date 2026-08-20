import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LessonSchema } from '@/lib/content/lesson.schema';
import { codigoDe, localize } from '@/lib/content/localize';
import type { Lesson } from '@/lib/content/types';
import { STATIC_KINDS, verifyStatic } from '@/lib/engine/static';

/**
 * Lo que el servidor comprueba antes de pagar.
 *
 * Dos cosas distintas se prueban aquí, y la segunda es la que de verdad
 * protege al usuario: que **la solución de cada lección pasaría el filtro**.
 * Un filtro que rechaza la respuesta correcta no es un filtro, es un muro — y
 * el único que se enteraría sería quien acabara de terminar la lección.
 */

function todasLasLecciones(): Lesson[] {
  const root = path.resolve(import.meta.dirname, '../content/lessons');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : entry.name.endsWith('.lesson.json') ? [full] : [];
    });

  return walk(root).map((file) => LessonSchema.parse(JSON.parse(readFileSync(file, 'utf8'))));
}

/** Los archivos con los que la lección se da por terminada. */
function codigoFinal(lesson: Lesson): Record<string, string> {
  const files = Object.fromEntries(
    lesson.workspace.files.map((f) => [f.path, codigoDe(f.content)]),
  );
  const ultimo = lesson.steps.at(-1);

  // El del último paso manda; si no lo publica, el de la lección entera.
  for (const archivo of ultimo?.solution ?? lesson.solution?.files ?? []) {
    files[archivo.path] = codigoDe(archivo.content);
  }
  return files;
}

function reglasDelUltimoPaso(lesson: Lesson) {
  const localized = localize(lesson, 'es');
  const ultimo = localized.steps.at(-1);
  return (ultimo?.ruleIds ?? [])
    .map((id) => localized.rules.find((rule) => rule.id === id))
    .filter((rule): rule is NonNullable<typeof rule> => Boolean(rule));
}

test('⭐ solo se juzga lo que no necesita ejecutar nada', () => {
  const reglas = [
    { id: 'a', kind: 'regex-must', file: 'x.js', pattern: 'hola', severity: 'error' },
    { id: 'b', kind: 'stdout-match', equals: 'hola', severity: 'error' },
    { id: 'c', kind: 'dom-assert', selector: 'p', assert: 'exists', severity: 'error' },
  ] as never;

  const veredicto = verifyStatic(reglas, { 'x.js': 'hola' });

  assert.equal(veredicto.comprobadas, 1, 'se juzgó algo que necesita ejecución');
  assert.equal(veredicto.fueraDeAlcance, 2);
  assert.deepEqual(veredicto.fallidas, []);
});

test('⭐ un aviso no puede impedir cobrar', () => {
  const reglas = [
    { id: 'estilo', kind: 'regex-forbid', file: 'x.js', pattern: 'var ', severity: 'warn' },
  ] as never;

  const veredicto = verifyStatic(reglas, { 'x.js': 'var a = 1;' });

  // La regla falla, pero es un consejo: ni se cuenta ni bloquea.
  assert.equal(veredicto.comprobadas, 0);
  assert.deepEqual(veredicto.fallidas, []);
});

test('⭐ el código que no cumple se detecta, y se dice cuál', () => {
  const reglas = [
    { id: 'usa-foreach', kind: 'regex-must', file: 'x.php', pattern: 'foreach', severity: 'error' },
  ] as never;

  assert.deepEqual(verifyStatic(reglas, { 'x.php': 'echo 1;' }).fallidas, ['usa-foreach']);
  assert.deepEqual(verifyStatic(reglas, { 'x.php': 'foreach ($a as $b) {}' }).fallidas, []);
});

test('un archivo que no existe no cumple una regla que lo mira', () => {
  const reglas = [
    { id: 'r', kind: 'regex-must', file: 'no-existe.js', pattern: 'x', severity: 'error' },
  ] as never;

  assert.deepEqual(verifyStatic(reglas, {}).fallidas, ['r']);
});

const lecciones = todasLasLecciones();

for (const lesson of lecciones) {
  const reglas = reglasDelUltimoPaso(lesson);
  const estaticas = reglas.filter(
    (rule) => rule.severity === 'error' && STATIC_KINDS.has(rule.kind),
  );
  if (estaticas.length === 0) continue;

  test(`⭐ ${lesson.id}: la solución de la lección pasa el filtro del servidor`, () => {
    const veredicto = verifyStatic(reglas as never, codigoFinal(lesson));

    /*
     * Si esto falla, quien termine la lección **no cobrará su XP**: el
     * servidor rechazaría la respuesta correcta. Es el fallo más caro de este
     * cambio y por eso se comprueba lección a lección, no de muestra.
     */
    assert.deepEqual(
      veredicto.fallidas,
      [],
      `el servidor rechazaría la solución de ${lesson.id}: ${veredicto.fallidas.join(', ')}`,
    );
  });

}

/** ¿Rechazaría el filtro el código con el que arranca la lección? */
function rechazaElPuntoDePartida(lesson: Lesson): boolean {
  const inicial = Object.fromEntries(
    lesson.workspace.files.map((f) => [f.path, codigoDe(f.content)]),
  );
  return verifyStatic(reglasDelUltimoPaso(lesson) as never, inicial).fallidas.length > 0;
}

test('⭐ el alcance del filtro está medido, no supuesto', () => {
  const conReglasEstaticas = lecciones.filter((lesson) =>
    reglasDelUltimoPaso(lesson).some(
      (rule) => rule.severity === 'error' && STATIC_KINDS.has(rule.kind),
    ),
  );
  const protegidas = lecciones.filter(rechazaElPuntoDePartida);

  /*
   * El número honesto, y por qué son dos números.
   *
   * En 26 de 35 lecciones el último paso trae alguna regla que el servidor
   * puede juzgar sin ejecutar nada. Pero **juzgar no es proteger**: en ocho de
   * ellas esas reglas son prohibiciones —«no imprimas el resultado a mano»— y
   * el archivo de partida las cumple sin haber hecho nada. Ahí el filtro
   * comprueba de verdad, pero no impide una reclamación falsa.
   *
   * Lo que de verdad se cierra son las {protegidas} lecciones cuyo código
   * inicial el servidor rechaza. Para el resto, la economía sigue apoyada en
   * el cliente y eso se dice en el ADR-23 en lugar de redondearlo.
   *
   * Los suelos existen para que esto no se degrade en silencio: una lección
   * nueva que termine en una regla de ejecución es una decisión, no una
   * deriva.
   */
  assert.ok(
    conReglasEstaticas.length >= 24,
    `solo ${conReglasEstaticas.length}/${lecciones.length} lecciones tienen algo que verificar`,
  );
  assert.ok(
    protegidas.length >= 16,
    `el filtro solo impide la reclamación falsa en ${protegidas.length}/${lecciones.length}`,
  );
});
