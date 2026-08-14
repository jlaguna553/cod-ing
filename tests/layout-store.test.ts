import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LAYOUT,
  useLayoutStore,
  widgetsOf,
  type WidgetId,
} from '@/stores/useLayoutStore';

/**
 * La disposición personalizada.
 *
 * Se prueba aquí y no en el navegador porque lo que puede romperse es la
 * aritmética del orden: insertar entre dos vecinos, no dejar huecos, y que
 * mover una tarjeta a otra columna no descoloque a las demás. El arrastre en
 * sí es un detalle de la interfaz; esto es el modelo.
 */

function reset() {
  useLayoutStore.getState().reset();
}

const orden = (zone: 'left' | 'guide' | 'dock') =>
  widgetsOf(useLayoutStore.getState().widgets, zone);

test('la disposición por defecto reproduce la pantalla de siempre', () => {
  reset();
  assert.deepEqual(orden('left'), ['session', 'lesson-info', 'files', 'achievements', 'locale']);
  assert.deepEqual(orden('guide'), ['brief', 'guide']);
  assert.deepEqual(orden('dock'), ['task', 'nav', 'tests']);
});

test('ocultar una tarjeta la saca de su zona sin perder su sitio', () => {
  reset();
  useLayoutStore.getState().setVisible('files', false);
  assert.deepEqual(orden('left'), ['session', 'lesson-info', 'achievements', 'locale']);

  useLayoutStore.getState().setVisible('files', true);
  assert.deepEqual(orden('left'), ['session', 'lesson-info', 'files', 'achievements', 'locale']);
});

test('⭐ mover a otra zona la inserta donde se pide, no al final', () => {
  reset();
  useLayoutStore.getState().moveWidget('files', 'dock', 1);
  assert.deepEqual(orden('dock'), ['task', 'files', 'nav', 'tests']);
  assert.deepEqual(orden('left'), ['session', 'lesson-info', 'achievements', 'locale']);
});

test('⭐ insertar al principio de una zona funciona', () => {
  reset();
  useLayoutStore.getState().moveWidget('tests', 'left', 0);
  assert.deepEqual(orden('left'), [
    'tests',
    'session',
    'lesson-info',
    'files',
    'achievements',
    'locale',
  ]);
});

test('⭐ tras cualquier movimiento los órdenes quedan sin huecos ni empates', () => {
  reset();
  useLayoutStore.getState().moveWidget('guide', 'left', 2);
  useLayoutStore.getState().moveWidget('session', 'dock', 0);
  useLayoutStore.getState().nudge('files', -1);

  const { widgets } = useLayoutStore.getState();
  for (const zone of ['left', 'guide', 'dock'] as const) {
    const ordenes = widgetsOf(widgets, zone, true).map((id: WidgetId) => widgets[id].order);
    assert.deepEqual(ordenes, ordenes.map((_, index) => index), `la zona ${zone} tiene huecos`);
  }
});

test('subir y bajar respeta los extremos en vez de dar la vuelta', () => {
  reset();
  useLayoutStore.getState().nudge('session', -1);
  assert.deepEqual(orden('left')[0], 'session', 'la primera no sube más');

  useLayoutStore.getState().nudge('locale', 1);
  assert.deepEqual(orden('left').at(-1), 'locale', 'la última no baja más');

  useLayoutStore.getState().nudge('session', 1);
  assert.deepEqual(orden('left').slice(0, 2), ['lesson-info', 'session']);
});

test('⭐ los anchos se recortan a un rango usable', () => {
  reset();
  useLayoutStore.getState().setColumn('left', 20);
  assert.ok(useLayoutStore.getState().columns.left >= 180, 'no se puede dejar invisible');

  useLayoutStore.getState().setColumn('left', 5000);
  assert.ok(useLayoutStore.getState().columns.left <= 640, 'no se puede comer la pantalla');

  useLayoutStore.getState().setEditorRatio(0.99);
  assert.ok(useLayoutStore.getState().editorRatio <= 0.85, 'la salida no puede desaparecer');
});

test('restablecer devuelve todo, incluida una tarjeta oculta', () => {
  reset();
  useLayoutStore.getState().setVisible('achievements', false);
  useLayoutStore.getState().moveWidget('tests', 'left', 0);
  useLayoutStore.getState().setColumn('right', 600);

  useLayoutStore.getState().reset();
  assert.deepEqual(useLayoutStore.getState().widgets, DEFAULT_LAYOUT);
  assert.equal(useLayoutStore.getState().columns.right, 400);
});

test('⭐ soltar una tarjeta sobre otra las intercambia, no empuja la lista', () => {
  reset();
  const antes = orden('left');

  useLayoutStore.getState().swap('session', 'files');

  // `session` y `files` cambian de sitio; las demás no se mueven.
  assert.deepEqual(orden('left'), ['files', 'lesson-info', 'session', 'achievements', 'locale']);
  assert.equal(orden('left').length, antes.length);
});

test('⭐ el intercambio funciona entre columnas distintas', () => {
  reset();
  useLayoutStore.getState().swap('files', 'tests');

  assert.ok(orden('left').includes('tests'), 'tests baja a la izquierda');
  assert.ok(orden('dock').includes('files'), 'files sube a la franja fija');
  // Y cada una ocupa el sitio exacto de la otra, sin desplazar a nadie.
  assert.deepEqual(orden('left'), ['session', 'lesson-info', 'tests', 'achievements', 'locale']);
  assert.deepEqual(orden('dock'), ['task', 'nav', 'files']);
});

test('intercambiar una tarjeta consigo misma no hace nada', () => {
  reset();
  const antes = orden('left');
  useLayoutStore.getState().swap('files', 'files');
  assert.deepEqual(orden('left'), antes);
});

test('⭐ el alto por tarjeta se guarda, se recorta y se puede devolver a automático', () => {
  reset();
  assert.equal(useLayoutStore.getState().heights.files, undefined, 'por defecto, automático');

  useLayoutStore.getState().setHeight('files', 320);
  assert.equal(useLayoutStore.getState().heights.files, 320);

  useLayoutStore.getState().setHeight('files', 5);
  assert.ok(useLayoutStore.getState().heights.files! >= 64, 'no se puede dejar invisible');

  useLayoutStore.getState().setHeight('files', null);
  assert.equal(useLayoutStore.getState().heights.files, undefined, 'vuelve a automático');
});

test('restablecer también borra los altos y la franja fija', () => {
  reset();
  useLayoutStore.getState().setHeight('guide', 300);
  useLayoutStore.getState().setDockHeight(420);

  useLayoutStore.getState().reset();
  assert.deepEqual(useLayoutStore.getState().heights, {});
  assert.equal(useLayoutStore.getState().dockHeight, null);
});
