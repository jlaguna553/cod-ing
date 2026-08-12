'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useRunnerStore } from '@/stores/useRunnerStore';

/**
 * Consola del programa del usuario.
 *
 * Existe porque faltaba lo más básico: las lecciones de JavaScript imprimen
 * con `console.log` y la vista previa solo mostraba el DOM. En `js-01` la
 * comprobación pide la salida `Ada 10 cyan` y no había **ningún sitio** donde
 * verla — el usuario tenía que adivinar qué había impreso su código.
 *
 * Se usa `<pre>` y no un `<div>` por línea porque la salida de un programa es
 * texto preformateado: los espacios y los saltos importan.
 */
export function ConsolePane() {
  const t = useTranslations();
  const logs = useRunnerStore((s) => s.logs);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Autoscroll: lo último impreso es lo que interesa.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [logs]);

  if (logs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-[var(--color-ink-faint)]">{t('tests.runFirst')}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-3">
      {/* `role="log"` + etiqueta: la salida del programa es una región propia,
          distinguible de los bloques de código que el markdown de la guía
          también renderiza como <pre>. */}
      <pre
        role="log"
        aria-label={t('panels.console')}
        className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed"
      >
        {logs.map((log, index) => (
          <span
            key={index}
            style={{
              color:
                log.stream === 'stderr'
                  ? 'var(--color-damage)'
                  : log.stream === 'system'
                    ? 'var(--color-ink-faint)'
                    : 'var(--color-ink)',
            }}
          >
            {log.text}
          </span>
        ))}
      </pre>
      <div ref={bottomRef} />
    </div>
  );
}
