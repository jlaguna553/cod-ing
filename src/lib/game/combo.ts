/**
 * Mecánica de combo.
 *
 * Lógica pura y sin relojes propios: recibe el instante como argumento. Eso la
 * hace probable en Node sin falsear timers, que es donde de verdad se verifica
 * que el decay y el anti-cheat hacen lo que dicen.
 */

/** Sin pulsaciones durante este tiempo, el combo se rompe. */
export const COMBO_WINDOW_MS = 1_800;

/** Umbral a partir del cual un pegado se considera trampa (ADR-06). */
export const PASTE_LIMIT = 40;

/** Escalones del multiplicador: golpes necesarios → multiplicador. */
const TIERS: { hits: number; multiplier: number; label: ComboLabel }[] = [
  { hits: 0, multiplier: 1, label: null },
  { hits: 10, multiplier: 1.25, label: 'warm' },
  { hits: 25, multiplier: 1.5, label: 'spree' },
  { hits: 50, multiplier: 2, label: 'fire' },
  { hits: 90, multiplier: 2.5, label: 'unstoppable' },
  { hits: 150, multiplier: 3, label: 'legendary' },
];

export type ComboLabel = 'warm' | 'spree' | 'fire' | 'unstoppable' | 'legendary' | null;

export interface ComboState {
  count: number;
  best: number;
  multiplier: number;
  label: ComboLabel;
  lastHitAt: number;
}

export const initialCombo: ComboState = {
  count: 0,
  best: 0,
  multiplier: 1,
  label: null,
  lastHitAt: 0,
};

function tierFor(count: number) {
  let current = TIERS[0];
  for (const tier of TIERS) if (count >= tier.hits) current = tier;
  return current;
}

/**
 * Registra una pulsación productiva.
 *
 * Se ignoran las teclas de navegación en el llamador: contar flechas y
 * `Ctrl` como progreso convertiría el combo en un premio por apoyarse en el
 * teclado, que es justo lo contrario de lo que quiere medir.
 */
export function registerHit(state: ComboState, now: number): ComboState {
  const expired = state.lastHitAt > 0 && now - state.lastHitAt > COMBO_WINDOW_MS;
  const count = (expired ? 0 : state.count) + 1;
  const tier = tierFor(count);

  return {
    count,
    best: Math.max(state.best, count),
    multiplier: tier.multiplier,
    label: tier.label,
    lastHitAt: now,
  };
}

/** Rompe el combo conservando el récord. */
export function breakCombo(state: ComboState): ComboState {
  return { ...state, count: 0, multiplier: 1, label: null, lastHitAt: 0 };
}

/** ¿Ha caducado la ventana? Para que la UI lo refleje sin esperar a otra tecla. */
export function hasExpired(state: ComboState, now: number): boolean {
  return state.count > 0 && state.lastHitAt > 0 && now - state.lastHitAt > COMBO_WINDOW_MS;
}

/**
 * Anti-cheat (ADR-06).
 *
 * Un pegado grande **rompe** el combo en lugar de dispararlo. Sin esto,
 * seleccionar la solución y pegarla daría el multiplicador máximo, y
 * «Coding Spree!» dejaría de significar nada. Se permiten pegados pequeños
 * porque mover una línea de sitio es trabajo legítimo.
 */
export function isCheatPaste(text: string): boolean {
  return text.length > PASTE_LIMIT;
}

/**
 * ¿Cuenta la tecla como pulsación productiva?
 *
 * Mantener una tecla pulsada genera repeticiones automáticas; el llamador debe
 * filtrarlas con `event.repeat`. Aquí solo se decide por el tipo de tecla.
 */
export function isProductiveKey(key: string, options: { repeat?: boolean } = {}): boolean {
  if (options.repeat) return false;
  if (key.length === 1) return true;
  return key === 'Enter' || key === 'Backspace' || key === 'Tab';
}
