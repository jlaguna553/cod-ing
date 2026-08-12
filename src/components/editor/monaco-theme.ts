import type { Monaco } from '@monaco-editor/react';

export const THEME_NAME = 'codequest-crt';

/**
 * Tema de Monaco alineado con los tokens de `globals.css`.
 *
 * Los colores se escriben aquí en literal y no como `var(--color-…)` porque
 * Monaco pinta sobre canvas y no resuelve variables CSS. Si cambian los tokens
 * del tema, hay que tocar los dos sitios — es el precio de que el editor no
 * sea DOM.
 */
export function defineMonacoTheme(monaco: Monaco) {
  monaco.editor.defineTheme(THEME_NAME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5a6b87', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c084fc' },
      { token: 'string', foreground: '4ade80' },
      { token: 'number', foreground: 'fbbf24' },
      { token: 'type', foreground: '22d3ee' },
      { token: 'function', foreground: '22d3ee' },
      { token: 'variable', foreground: 'e6edf7' },
      { token: 'tag', foreground: 'c084fc' },
      { token: 'attribute.name', foreground: '22d3ee' },
      { token: 'attribute.value', foreground: '4ade80' },
      { token: 'delimiter', foreground: '93a3bd' },
    ],
    colors: {
      'editor.background': '#05070d',
      'editor.foreground': '#e6edf7',
      'editor.lineHighlightBackground': '#111726',
      'editor.selectionBackground': '#263148',
      'editorCursor.foreground': '#22d3ee',
      'editorLineNumber.foreground': '#3b4a6b',
      'editorLineNumber.activeForeground': '#22d3ee',
      'editorIndentGuide.background1': '#1a2233',
      'editorGutter.background': '#05070d',
      'editorWidget.background': '#111726',
      'editorWidget.border': '#263148',
      'scrollbarSlider.background': '#26314880',
      'scrollbarSlider.hoverBackground': '#3b4a6b80',
    },
  });
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
    case 'vue':
      // Monaco no trae gramática de Vue SFC; HTML es la aproximación menos
      // mala: colorea el template y no rompe el script.
      return 'html';
    default:
      return path === 'Dockerfile' ? 'dockerfile' : 'plaintext';
  }
}
