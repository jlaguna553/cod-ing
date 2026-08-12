import type { Locale, LocalizedText } from './types';

export const DEFAULT_LOCALE: Locale = 'es';

/**
 * Resuelve un texto bilingüe. El fallback nunca debe activarse en producción
 * (el schema exige ambos idiomas), pero evita una pantalla en blanco si una
 * lección llega sin validar desde una fuente externa.
 */
export function t(text: LocalizedText, locale: Locale): string {
  return text[locale] ?? text[DEFAULT_LOCALE] ?? '';
}

/**
 * Localiza en profundidad cualquier estructura de contenido: recorre el árbol
 * y colapsa todo `{es, en}` a un string.
 *
 * Se aplica UNA vez, al entrar en la lección, y el resultado se pasa a la UI.
 * Así ningún componente necesita conocer el locale, y cambiar de idioma es
 * re-localizar el mismo objeto — sin tocar progreso, buffers ni combo (ADR-01).
 */
export type Localized<T> = T extends LocalizedText
  ? string
  : T extends readonly (infer U)[]
    ? Localized<U>[]
    : T extends object
      ? { [K in keyof T]: Localized<T[K]> }
      : T;

function isLocalizedText(value: unknown): value is LocalizedText {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.includes('es') &&
    keys.includes('en') &&
    typeof (value as LocalizedText).es === 'string' &&
    typeof (value as LocalizedText).en === 'string'
  );
}

export function localize<T>(node: T, locale: Locale): Localized<T> {
  if (isLocalizedText(node)) return t(node, locale) as Localized<T>;
  if (Array.isArray(node)) return node.map((item) => localize(item, locale)) as Localized<T>;
  if (typeof node === 'object' && node !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = localize(value, locale);
    return out as Localized<T>;
  }
  return node as Localized<T>;
}
