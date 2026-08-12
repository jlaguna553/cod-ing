'use client';

import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';

/**
 * Renderiza el markdown de las lecciones con el tema de la consola.
 *
 * El contenido viene de `content/**`, que es nuestro y está validado en CI —
 * no hay entrada de usuario aquí, así que no hace falta sanitizado extra.
 * Si algún día se aceptan lecciones de terceros, este es el punto donde
 * añadir `rehype-sanitize`.
 */
const components: Components = {
  p: ({ children }) => (
    <p className="mb-3 text-[13px] leading-relaxed text-[var(--color-ink-dim)] last:mb-0">
      {children}
    </p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[var(--color-ink)]">{children}</strong>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 ml-4 list-disc space-y-1 text-[13px] text-[var(--color-ink-dim)] marker:text-[var(--color-neon)]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 ml-4 list-decimal space-y-1 text-[13px] text-[var(--color-ink-dim)] marker:text-[var(--color-neon)]">
      {children}
    </ol>
  ),
  a: ({ children, href }) => (
    <a href={href} className="text-[var(--color-neon)] underline underline-offset-2">
      {children}
    </a>
  ),
  code: ({ children, className }) => {
    // Bloque cercado: react-markdown le pone `language-*`. Inline: no.
    const isBlock = Boolean(className);
    if (isBlock) {
      return (
        <code className="block overflow-x-auto whitespace-pre p-3 font-mono text-[12px] leading-relaxed text-[var(--color-ink)]">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded border border-[var(--color-border)] bg-[var(--color-abyss)] px-1 py-0.5 font-mono text-[12px] text-[var(--color-neon)]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-3 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-void)]">
      {children}
    </pre>
  ),
};

export function Markdown({ children }: { children: string }) {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
}
