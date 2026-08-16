import type { Monaco } from '@monaco-editor/react';

export const THEME_NAME = 'codequest-crt';

/**
 * Tema de Monaco derivado de la paleta activa.
 *
 * Monaco pinta sobre canvas y no resuelve `var(--color-…)`, así que necesita
 * colores en literal. Antes estaban escritos a mano aquí, con el precio de
 * tener que tocar dos sitios al cambiar un token — y con el resultado visible
 * al añadir paletas: con el tema claro, el editor se quedaba siendo un
 * rectángulo oscuro en medio de una página blanca.
 *
 * Se resuelven leyendo del DOM las mismas variables que usa el resto de la
 * aplicación. Así una paleta nueva no obliga a definir un tema de editor: basta
 * con declarar sus variables en `globals.css`.
 */

/** Lee una variable CSS del `<html>`, ya resuelta a color. */
function token(nombre: string, respaldo: string): string {
  if (typeof window === 'undefined') return respaldo;
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  return valor || respaldo;
}

export function defineMonacoTheme(monaco: Monaco) {
  const void_ = token('--color-void', '#05070d');
  const panel = token('--color-panel', '#111726');
  const raised = token('--color-raised', '#1a2233');
  const border = token('--color-border', '#263148');
  const borderGlow = token('--color-border-glow', '#3b4a6b');
  const ink = token('--color-ink', '#e6edf7');
  const inkDim = token('--color-ink-dim', '#93a3bd');
  const inkFaint = token('--color-ink-faint', '#5a6b87');
  const neon = token('--color-neon', '#22d3ee');
  const neonAlt = token('--color-neon-alt', '#c084fc');
  const power = token('--color-power', '#fbbf24');
  const success = token('--color-success', '#4ade80');

  // Monaco quiere los colores de los tokens SIN `#`.
  const hex = (color: string) => color.replace('#', '');

  /*
   * `base` decide los colores de todo lo que no se declara aquí —menús,
   * sugerencias, resaltados—. Elegirlo por la luminosidad del fondo evita que
   * en la paleta clara aparezcan desplegables negros.
   */
  const claro = luminancia(void_) > 0.5;

  monaco.editor.defineTheme(THEME_NAME, {
    base: claro ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: hex(inkFaint), fontStyle: 'italic' },
      { token: 'keyword', foreground: hex(neonAlt) },
      { token: 'string', foreground: hex(success) },
      { token: 'number', foreground: hex(power) },
      { token: 'type', foreground: hex(neon) },
      { token: 'function', foreground: hex(neon) },
      { token: 'variable', foreground: hex(ink) },
      { token: 'tag', foreground: hex(neonAlt) },
      { token: 'attribute.name', foreground: hex(neon) },
      { token: 'attribute.value', foreground: hex(success) },
      { token: 'delimiter', foreground: hex(inkDim) },
    ],
    colors: {
      'editor.background': void_,
      'editor.foreground': ink,
      'editor.lineHighlightBackground': panel,
      'editor.selectionBackground': border,
      'editorCursor.foreground': neon,
      'editorLineNumber.foreground': borderGlow,
      'editorLineNumber.activeForeground': neon,
      'editorIndentGuide.background1': raised,
      'editorGutter.background': void_,
      'editorWidget.background': panel,
      'editorWidget.border': border,
      'scrollbarSlider.background': `${border}80`,
      'scrollbarSlider.hoverBackground': `${borderGlow}80`,
    },
  });
}

/** Luminancia relativa aproximada de un color hexadecimal. */
export function luminancia(color: string): number {
  const limpio = color.replace('#', '');
  if (limpio.length < 6) return 0;
  const [r, g, b] = [0, 2, 4].map((inicio) => parseInt(limpio.slice(inicio, inicio + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Extensión → lenguaje de Monaco. */
export function languageOf(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';

  switch (extension) {
    case 'js':
    case 'jsx':
    case 'mjs':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'typescript';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'sh':
    case 'bash':
      return 'shell';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'sql':
      return 'sql';
    case 'php':
      return 'php';
    case 'vue':
      // Monaco no trae gramática de Vue SFC; HTML es la aproximación menos
      // mala: colorea el template y no rompe el script.
      return 'html';
    default:
      return path === 'Dockerfile' ? 'dockerfile' : 'plaintext';
  }
}
