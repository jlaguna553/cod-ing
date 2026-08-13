'use client';

import { useEffect, useRef } from 'react';
import { useLocale } from 'next-intl';
import type { Locale } from '@/lib/content/types';
import { useLessonStore } from '@/stores/useLessonStore';
import { useRunnerStore, type LogLine } from '@/stores/useRunnerStore';
import { useShallow } from 'zustand/react/shallow';
/*
 * Hoja de estilos de xterm. Sin ella la terminal *parece* funcionar —el
 * renderizador DOM inyecta sus propios estilos para las filas— pero le faltan
 * dos cosas que sí son suyas: el `.xterm-char-measure-element` queda visible
 * (una fila de `hhhh…` sobre la salida) y el viewport se queda a 0 de alto, de
 * modo que no se puede subir a releer lo que ya ha salido.
 *
 * Se importa en el componente y no en el CSS global a propósito: es la
 * dependencia de este componente, y así viaja con él.
 */
import '@xterm/xterm/css/xterm.css';

/**
 * Terminal interactiva sobre xterm.js.
 *
 * xterm se carga con `import()` dentro de un efecto porque toca `window` al
 * construirse: importarlo arriba rompería el render del servidor.
 *
 * La entrada la gestiona el propio xterm carácter a carácter (`onData`), no un
 * `<input>` superpuesto. Es lo que permite que las teclas de control se
 * comporten como en una terminal de verdad en lugar de como en un formulario.
 */
export function XtermPane() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<{ write: (data: string) => void; dispose: () => void } | null>(null);
  const lineRef = useRef('');
  const printedRef = useRef(0);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);

  const locale = useLocale() as Locale;
  const runCommand = useRunnerStore((s) => s.runCommand);
  const logs = useRunnerStore((s) => s.logs);
  const allowed = useLessonStore(
    useShallow((s) => s.lesson?.runtime.terminal?.allowedCommands ?? []),
  );

  useEffect(() => {
    let disposed = false;
    let fitObserver: ResizeObserver | null = null;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed || !containerRef.current) return;

      const terminal = new Terminal({
        convertEol: true,
        cursorBlink: true,
        fontSize: 12.5,
        fontFamily: 'var(--font-mono), monospace',
        theme: {
          background: '#05070d',
          foreground: '#e6edf7',
          cursor: '#22d3ee',
          selectionBackground: '#263148',
        },
      });

      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(containerRef.current);
      fit.fit();

      fitObserver = new ResizeObserver(() => fit.fit());
      fitObserver.observe(containerRef.current);

      terminal.onData((data) => {
        const code = data.charCodeAt(0);

        // Enter
        if (data === '\r') {
          const command = lineRef.current.trim();
          terminal.write('\r\n');
          lineRef.current = '';
          if (command !== '') {
            historyRef.current.push(command);
            historyIndexRef.current = historyRef.current.length;
            void runCommand(command);
          }
          return;
        }

        // Backspace — hay que borrar también en pantalla, xterm no lo hace solo.
        if (code === 127) {
          if (lineRef.current.length > 0) {
            lineRef.current = lineRef.current.slice(0, -1);
            terminal.write('\b \b');
          }
          return;
        }

        // Flechas arriba/abajo: historial, como en cualquier shell.
        if (data === '\x1b[A' || data === '\x1b[B') {
          const history = historyRef.current;
          if (history.length === 0) return;
          const next =
            data === '\x1b[A'
              ? Math.max(0, historyIndexRef.current - 1)
              : Math.min(history.length, historyIndexRef.current + 1);
          historyIndexRef.current = next;
          const recalled = history[next] ?? '';
          terminal.write(`\r\x1b[K${recalled}`);
          lineRef.current = recalled;
          return;
        }

        // Ctrl+C
        if (code === 3) {
          terminal.write('^C\r\n');
          lineRef.current = '';
          return;
        }

        if (code < 32) return;

        lineRef.current += data;
        terminal.write(data);
      });

      terminalRef.current = terminal;

      if (allowed.length > 0) {
        terminal.write(
          `\x1b[38;5;244m${
            locale === 'es' ? 'Comandos disponibles' : 'Available commands'
          }: ${allowed.join(', ')}\x1b[0m\r\n`,
        );
      }
    })();

    return () => {
      disposed = true;
      fitObserver?.disconnect();
      terminalRef.current?.dispose();
      terminalRef.current = null;
    };
    // Se monta una vez por lección; `allowed` y `locale` solo afectan al saludo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Vuelca al terminal solo lo que aún no se ha escrito. */
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    for (const log of logs.slice(printedRef.current)) {
      terminal.write(colorize(log));
    }
    printedRef.current = logs.length;
  }, [logs]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}

function colorize(log: LogLine): string {
  if (log.stream === 'stderr') return `\x1b[38;5;203m${log.text}\x1b[0m`;
  if (log.stream === 'system') return `\x1b[38;5;80m${log.text}\x1b[0m`;
  return log.text;
}
