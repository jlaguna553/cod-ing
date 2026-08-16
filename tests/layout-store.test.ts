import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_COLUMNS,
  DEFAULT_LAYOUT,
  migrateLayout,
  useLayoutStore,
  widgetsOf,
  WIDGETS,
  type WidgetId,
  type WidgetLayout,
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
  // A la izquierda lo que se lee; a la derecha lo que se usa.
  assert.deepEqual(orden('left'), ['guide', 'files']);
  assert.deepEqual(orden('guide'), ['brief', 'session', 'achievements']);
  assert.deepEqual(orden('dock'), ['challenge']);
});

test('ocultar una tarjeta la saca de su zona sin perder su sitio', () => {
  reset();
  useLayoutStore.getState().setVisible('files', false);
  assert.deepEqual(orden('left'), ['guide']);

  useLayoutStore.getState().setVisible('files', true);
  assert.deepEqual(orden('left'), ['guide', 'files']);
});

test('⭐ mover a otra zona la inserta donde se pide, no al final', () => {
  reset();
  useLayoutStore.getState().moveWidget('files', 'dock', 1);
  assert.deepEqual(orden('dock'), ['challenge', 'files']);
  assert.deepEqual(orden('left'), ['guide']);
});

test('⭐ insertar al principio de una zona funciona', () => {
  reset();
  useLayoutStore.getState().moveWidget('challenge', 'left', 0);
  assert.deepEqual(orden('left'), ['challenge', 'guide', 'files']);
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
  useLayoutStore.getState().nudge('guide', -1);
  assert.deepEqual(orden('left')[0], 'guide', 'la primera no sube más');

  useLayoutStore.getState().nudge('files', 1);
  assert.deepEqual(orden('left').at(-1), 'files', 'la última no baja más');

  useLayoutStore.getState().nudge('guide', 1);
  assert.deepEqual(orden('left'), ['files', 'guide']);
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
  useLayoutStore.getState().moveWidget('challenge', 'left', 0);
  useLayoutStore.getState().setColumn('right', 600);

  useLayoutStore.getState().reset();
  assert.deepEqual(useLayoutStore.getState().widgets, DEFAULT_LAYOUT);
  assert.equal(useLayoutStore.getState().columns.right, DEFAULT_COLUMNS.right);
});

test('⭐ soltar una tarjeta sobre otra las intercambia, no empuja la lista', () => {
  reset();
  const antes = orden('left');

  useLayoutStore.getState().swap('guide', 'files');

  // Las dos cambian de sitio; ninguna otra se mueve.
  assert.deepEqual(orden('left'), ['files', 'guide']);
  assert.equal(orden('left').length, antes.length);
});

test('⭐ el intercambio funciona entre columnas distintas', () => {
  reset();
  useLayoutStore.getState().swap('files', 'challenge');

  assert.ok(orden('left').includes('challenge'), 'el reto pasa a la izquierda');
  assert.ok(orden('dock').includes('files'), 'files sube a la franja fija');
  // Y cada una ocupa el sitio exacto de la otra, sin desplazar a nadie.
  assert.deepEqual(orden('left'), ['guide', 'challenge']);
  assert.deepEqual(orden('dock'), ['files']);
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

test('⭐ una disposición guardada con las tarjetas viejas sigue abriendo', () => {
  /*
   * Lo que había en `localStorage` de quien ya usaba la aplicación: tres
   * tarjetas que ya no existen, una de ellas movida a mano. Sin migración,
   * `widgets['challenge']` sería `undefined` al pintar y la pantalla se
   * quedaría en blanco — el peor final posible para un cambio de estilo.
   */
  const viejo = {
    widgets: {
      session: { zone: 'left', order: 0, visible: true },
      'lesson-info': { zone: 'left', order: 1, visible: true },
      files: { zone: 'left', order: 2, visible: false },
      achievements: { zone: 'left', order: 3, visible: true },
      locale: { zone: 'left', order: 4, visible: true },
      brief: { zone: 'guide', order: 0, visible: true },
      guide: { zone: 'guide', order: 1, visible: true },
      task: { zone: 'left', order: 5, visible: true },
      nav: { zone: 'dock', order: 1, visible: true },
      tests: { zone: 'dock', order: 2, visible: true },
    },
    heights: { task: 300, tests: 200 },
    columns: { left: 300, right: 500 },
  };

  const migrado = migrateLayout(viejo, 3) as {
    widgets: Record<WidgetId, { zone: string; visible: boolean }>;
    heights: Record<string, number>;
    columns: { left: number };
  };

  // Todas las tarjetas actuales existen, y solo ellas.
  assert.deepEqual(Object.keys(migrado.widgets).sort(), [...WIDGETS].sort());

  // El reto hereda el sitio y el alto que tenía «reto», no vuelve al defecto.
  assert.equal(migrado.widgets.challenge.zone, 'left');
  assert.equal(migrado.heights.challenge, 300);

  // Y lo que el usuario había decidido sobre lo que sigue existiendo se respeta.
  assert.equal(migrado.widgets.files.visible, false);
  assert.equal(migrado.columns.left, 300);
});

test('migrar dos veces no vuelve a tocar nada', () => {
  const yaMigrado = { widgets: DEFAULT_LAYOUT, heights: { challenge: 250 } };
  assert.equal(migrateLayout(yaMigrado, 4), yaMigrado);
});

test('⭐ cambiar la disposición de fábrica no le mueve las tarjetas a quien las colocó', () => {
  /*
   * Dos usuarios con la misma versión guardada. Uno no tocó nada; el otro se
   * llevó los archivos a la franja fija. Adoptar la disposición nueva es
   * correcto para el primero y una grosería para el segundo: le desharía
   * exactamente el trabajo que la personalización venía a permitir.
   */
  const deFabrica = {
    widgets: {
      session: { zone: 'left', order: 0, visible: true },
      files: { zone: 'left', order: 1, visible: true },
      achievements: { zone: 'left', order: 2, visible: true },
      brief: { zone: 'guide', order: 0, visible: true },
      guide: { zone: 'guide', order: 1, visible: true },
      challenge: { zone: 'dock', order: 0, visible: true },
    },
    columns: { left: 260, right: 400 },
  };

  const adoptada = migrateLayout(deFabrica, 4) as {
    widgets: Record<WidgetId, WidgetLayout>;
    columns: { left: number };
  };
  assert.equal(adoptada.widgets.guide.zone, 'left', 'la guía pasa a la izquierda');
  assert.equal(adoptada.widgets.session.zone, 'guide', 'el marcador pasa a la derecha');
  assert.equal(adoptada.columns.left, DEFAULT_COLUMNS.left, 'y las columnas se ensanchan');

  const personalizada = {
    widgets: {
      ...deFabrica.widgets,
      files: { zone: 'dock', order: 1, visible: true },
    },
    columns: { left: 260, right: 400 },
  };

  const respetada = migrateLayout(personalizada, 4) as { widgets: Record<WidgetId, WidgetLayout> };
  assert.equal(respetada.widgets.files.zone, 'dock', 'lo que movió sigue donde lo puso');
  assert.equal(respetada.widgets.guide.zone, 'guide', 'y nada más se recoloca');
});
