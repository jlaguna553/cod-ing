import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Disposición de la pantalla de juego, elegida por el usuario.
 *
 * La pantalla dejó de tener una composición fija: cada tarjeta puede ocultarse,
 * cambiar de columna y cambiar de orden, y las tres columnas se redimensionan.
 * Esto es lo único que recuerda esas decisiones, y vive **fuera del árbol de
 * React** con `persist`, por el mismo motivo del ADR-01 — cambiar de idioma
 * remonta el subárbol y la disposición no debe enterarse.
 *
 * Es preferencia de interfaz, no progreso: se guarda en el navegador y no viaja
 * al servidor. Si alguien entra desde otro dispositivo, empieza con la
 * disposición por defecto, que es exactamente lo que se espera de un ajuste de
 * ventana.
 */

/** Tarjetas que el usuario puede mover. El editor y la salida no: son el escenario. */
export const WIDGETS = [
  'session',
  'lesson-info',
  'files',
  'achievements',
  'locale',
  'brief',
  'guide',
  'task',
  'nav',
  'tests',
] as const;

export type WidgetId = (typeof WIDGETS)[number];

/**
 * Las tres zonas donde cabe una tarjeta.
 *
 * `dock` existe para no perder lo que se decidió antes: el reto y las pruebas
 * viven en una franja fija abajo a la derecha, y `guide` en una zona que sí se
 * desplaza. Que ahora se puedan mover no significa que la diferencia entre
 * «fijo» y «con scroll» desaparezca — significa que el usuario elige qué va en
 * cada sitio.
 */
export type Zone = 'left' | 'guide' | 'dock';

export interface WidgetLayout {
  zone: Zone;
  order: number;
  visible: boolean;
}

/** La disposición de siempre, y a la que devuelve el botón de restablecer. */
export const DEFAULT_LAYOUT: Record<WidgetId, WidgetLayout> = {
  session: { zone: 'left', order: 0, visible: true },
  'lesson-info': { zone: 'left', order: 1, visible: true },
  files: { zone: 'left', order: 2, visible: true },
  achievements: { zone: 'left', order: 3, visible: true },
  locale: { zone: 'left', order: 4, visible: true },
  brief: { zone: 'guide', order: 0, visible: true },
  guide: { zone: 'guide', order: 1, visible: true },
  task: { zone: 'dock', order: 0, visible: true },
  nav: { zone: 'dock', order: 1, visible: true },
  tests: { zone: 'dock', order: 2, visible: true },
};

/** Anchos de las columnas laterales, en píxeles. El centro se queda el resto. */
export const DEFAULT_COLUMNS = { left: 260, right: 400 };
/** Reparto vertical de la columna central: cuánto se lleva el editor. */
export const DEFAULT_EDITOR_RATIO = 0.6;
/** Alto de la franja fija de la derecha. `null` = el que pida su contenido. */
export const DEFAULT_DOCK_HEIGHT: number | null = null;

const LIMITS = {
  left: { min: 180, max: 640 },
  right: { min: 280, max: 780 },
  editorRatio: { min: 0.2, max: 0.85 },
  /** Alto de una tarjeta suelta y de la franja fija. */
  card: { min: 64, max: 1200 },
};

interface LayoutState {
  widgets: Record<WidgetId, WidgetLayout>;
  columns: { left: number; right: number };
  editorRatio: number;
  /**
   * Alto fijado a mano por tarjeta, en píxeles.
   *
   * Ausente = el alto que pida su contenido, que es lo correcto por defecto:
   * fijar de antemano el alto de todas obligaría a repartir a mano un espacio
   * que el navegador ya reparte bien.
   */
  heights: Partial<Record<WidgetId, number>>;
  /** Alto de la franja fija de la derecha. `null` = automático. */
  dockHeight: number | null;
  /** En modo edición aparecen los controles de mover, ocultar y reordenar. */
  editing: boolean;

  toggleEditing: () => void;
  setVisible: (id: WidgetId, visible: boolean) => void;
  /** Mueve una tarjeta a una zona, opcionalmente en una posición concreta. */
  moveWidget: (id: WidgetId, zone: Zone, index?: number) => void;
  /** Sube o baja una posición dentro de su zona. Es la vía accesible al arrastre. */
  nudge: (id: WidgetId, direction: -1 | 1) => void;
  setColumn: (side: 'left' | 'right', px: number) => void;
  setEditorRatio: (ratio: number) => void;
  setHeight: (id: WidgetId, px: number | null) => void;
  setDockHeight: (px: number | null) => void;
  /** Intercambia dos tarjetas de sitio, aunque estén en columnas distintas. */
  swap: (a: WidgetId, b: WidgetId) => void;
  reset: () => void;
}

const clamp = (value: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, value));

/** Tarjetas visibles de una zona, ya ordenadas. */
export function widgetsOf(
  widgets: Record<WidgetId, WidgetLayout>,
  zone: Zone,
  includeHidden = false,
): WidgetId[] {
  return WIDGETS.filter((id) => widgets[id].zone === zone && (includeHidden || widgets[id].visible))
    .sort((a, b) => widgets[a].order - widgets[b].order);
}

/** Reasigna `order` como 0..n-1 para que no queden huecos ni empates. */
function renumber(widgets: Record<WidgetId, WidgetLayout>): Record<WidgetId, WidgetLayout> {
  const next = { ...widgets };
  for (const zone of ['left', 'guide', 'dock'] as const) {
    widgetsOf(next, zone, true).forEach((id, index) => {
      next[id] = { ...next[id], order: index };
    });
  }
  return next;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      widgets: DEFAULT_LAYOUT,
      columns: DEFAULT_COLUMNS,
      editorRatio: DEFAULT_EDITOR_RATIO,
      heights: {},
      dockHeight: DEFAULT_DOCK_HEIGHT,
      editing: false,

      toggleEditing: () => set((state) => ({ editing: !state.editing })),

      setVisible: (id, visible) =>
        set((state) => ({ widgets: { ...state.widgets, [id]: { ...state.widgets[id], visible } } })),

      moveWidget: (id, zone, index) =>
        set((state) => {
          const destino = widgetsOf(state.widgets, zone, true).filter((other) => other !== id);
          const posicion = index ?? destino.length;

          /*
           * Se numera con medios puntos para insertar entre dos vecinos sin
           * tocarlos, y `renumber` deja los enteros después. Reordenar el array
           * a mano sería más código y el mismo resultado.
           */
          const order = posicion === 0 ? -0.5 : (state.widgets[destino[posicion - 1]]?.order ?? 0) + 0.5;

          return {
            widgets: renumber({
              ...state.widgets,
              [id]: { ...state.widgets[id], zone, order, visible: true },
            }),
          };
        }),

      nudge: (id, direction) => {
        const { widgets } = get();
        const hermanos = widgetsOf(widgets, widgets[id].zone);
        const actual = hermanos.indexOf(id);
        const destino = actual + direction;
        if (actual === -1 || destino < 0 || destino >= hermanos.length) return;

        get().moveWidget(id, widgets[id].zone, destino);
      },

      setColumn: (side, px) =>
        set((state) => ({ columns: { ...state.columns, [side]: clamp(px, LIMITS[side]) } })),

      setEditorRatio: (ratio) => set({ editorRatio: clamp(ratio, LIMITS.editorRatio) }),

      setHeight: (id, px) =>
        set((state) => {
          const heights = { ...state.heights };
          if (px === null) delete heights[id];
          else heights[id] = clamp(px, LIMITS.card);
          return { heights };
        }),

      setDockHeight: (px) =>
        set({ dockHeight: px === null ? null : clamp(px, LIMITS.card) }),

      /*
       * Intercambio, no inserción.
       *
       * Soltar una tarjeta encima de otra cambia las dos de sitio: la que
       * estaba ahí se va a donde estaba la que llega. Insertar desplazaba a
       * todas las de abajo una posición, y con columnas de distinta longitud
       * eso descoloca más de lo que coloca — el usuario apunta a un hueco
       * concreto, no a «empujar la lista».
       */
      swap: (a, b) =>
        set((state) => {
          if (a === b) return state;
          const uno = state.widgets[a];
          const otro = state.widgets[b];

          return {
            widgets: renumber({
              ...state.widgets,
              [a]: { ...uno, zone: otro.zone, order: otro.order },
              [b]: { ...otro, zone: uno.zone, order: uno.order },
            }),
          };
        }),

      reset: () =>
        set({
          widgets: DEFAULT_LAYOUT,
          columns: DEFAULT_COLUMNS,
          editorRatio: DEFAULT_EDITOR_RATIO,
          heights: {},
          dockHeight: DEFAULT_DOCK_HEIGHT,
        }),
    }),
    {
      name: 'codequest.layout',
      // `editing` no se persiste: al volver, la pantalla está para jugar.
      partialize: ({ widgets, columns, editorRatio, heights, dockHeight }) => ({
        widgets,
        columns,
        editorRatio,
        heights,
        dockHeight,
      }),
      version: 2,
    },
  ),
);
