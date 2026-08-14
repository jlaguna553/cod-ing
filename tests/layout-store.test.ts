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
  assert.ok(useLayoutStore.getState().columns.left <= 480, 'no se puede comer la pantalla');

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
