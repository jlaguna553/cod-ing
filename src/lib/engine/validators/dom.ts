import type { Validator } from '../context';
import { verdict } from '../context';

/**
 * Aserciones sobre el DOM realmente renderizado.
 *
 * Es la diferencia entre "el código contiene `createElement`" y "en la página
 * hay tres `<li>`". Solo lo segundo demuestra que el ejercicio funciona.
 *
 * Sin documento devuelve `null` (pendiente) en lugar de fallar: significa que
 * el usuario aún no ha ejecutado nada, no que su código esté mal.
 */
export const domAssert: Validator<'dom-assert'> = (rule, context) => {
  const document = context.document;
  if (!document) return null;

  const nodes = Array.from(document.querySelectorAll(rule.selector));
  const first = nodes[0] ?? null;

  switch (rule.assert) {
    case 'exists':
      return verdict(nodes.length > 0, {
        detail: nodes.length > 0 ? undefined : { expected: rule.selector, actual: 'no encontrado' },
      });

    case 'notExists':
      return verdict(nodes.length === 0, {
        detail: nodes.length === 0 ? undefined : { actual: `${nodes.length} encontrados` },
      });

    case 'countEquals': {
      const expected = rule.count ?? 0;
      return verdict(nodes.length === expected, {
        detail: { expected: `${expected} × ${rule.selector}`, actual: `${nodes.length}` },
      });
    }

    case 'textEquals': {
      if (!first) return verdict(false, { detail: { expected: rule.expected, actual: 'no encontrado' } });
      const text = (first.textContent ?? '').trim();
      return verdict(text === (rule.expected ?? '').trim(), {
        detail: { expected: rule.expected, actual: text },
      });
    }

    case 'textContains': {
      if (!first) return verdict(false, { detail: { expected: rule.expected, actual: 'no encontrado' } });
      const text = (first.textContent ?? '').trim();
      return verdict(text.includes(rule.expected ?? ''), {
        detail: { expected: rule.expected, actual: text },
      });
    }

    case 'attrEquals': {
      if (!first) return verdict(false, { detail: { expected: rule.expected, actual: 'no encontrado' } });
      const value = first.getAttribute(rule.attribute ?? '');
      return verdict(value === rule.expected, {
        detail: { expected: rule.expected, actual: value ?? '(sin atributo)' },
      });
    }

    case 'styleEquals': {
      if (!first) return verdict(false, { detail: { expected: rule.expected, actual: 'no encontrado' } });
      // Estilo COMPUTADO, no el inline: es lo que el usuario ve. Un
      // `justify-content: center` heredado de una clase debe contar igual que
      // uno escrito en el elemento.
      const view = first.ownerDocument?.defaultView;
      const computed = view?.getComputedStyle(first as Element);
      const value = computed?.getPropertyValue(rule.attribute ?? '')?.trim() ?? '';
      return verdict(value === rule.expected, {
        detail: { expected: `${rule.attribute}: ${rule.expected}`, actual: value || '(sin valor)' },
      });
    }

    default:
      return verdict(false);
  }
};
