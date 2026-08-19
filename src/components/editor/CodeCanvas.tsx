'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { Loader2, Play, RotateCcw } from 'lucide-react';
import { useLessonStore } from '@/stores/useLessonStore';
import { useGameStore } from '@/stores/useGameStore';
import { useRunnerStore } from '@/stores/useRunnerStore';
import { useEvaluationStore } from '@/stores/useEvaluationStore';
import { runAndEvaluate } from '@/lib/game/attempt';
import { Panel } from '@/components/layout/GameShell';
import { PowerModeFX } from './PowerModeFX';
import { defineMonacoTheme, languageOf, THEME_NAME } from './monaco-theme';
import { setMonaco } from '@/lib/runners/monaco-bridge';
import { useLayoutStore } from '@/stores/useLayoutStore';
import { ComboCounter } from '@/components/gamification/ComboCounter';

/**
 * Editor de la lección: Monaco + Power Mode + decoraciones de daño.
 *
 * El contrato con el store no cambió respecto al `<textarea>` provisional de
 * la Fase 2 (`files`, `updateFile`, `activeFile`), que era justo el objetivo
 * de haberlo definido antes: cambiar el editor no tocó nada más.
 */
export function CodeCanvas() {
  const t = useTranslations();

  const activeFile = useLessonStore((s) => s.activeFile);
  const files = useLessonStore((s) => s.files);
  const updateFile = useLessonStore((s) => s.updateFile);
  const resetWorkspace = useLessonStore((s) => s.resetWorkspace);
  const fileMeta = useLessonStore((s) =>
    s.lesson?.workspace.files.find((f) => f.path === s.activeFile),
  );
  const focusLines = useLessonStore((s) => {
    const step = s.lesson?.steps[s.stepIndex];
    return step?.focusFile === s.activeFile ? step?.focusLines : undefined;
  });

  const registerKeystroke = useGameStore((s) => s.registerKeystroke);
  const registerPaste = useGameStore((s) => s.registerPaste);
  const performanceMode = useGameStore((s) => s.performanceMode);
  const comboMultiplier = useGameStore((s) => s.combo.multiplier);

  const runnerStatus = useRunnerStore((s) => s.status);
  const syncFile = useRunnerStore((s) => s.syncFile);

  const scheduleTypeCheck = useEvaluationStore((s) => s.scheduleTypeCheck);
  const results = useEvaluationStore((s) => s.results);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<PowerModeFX | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const syncTimer = useRef<number | null>(null);
  /** Marca del último `keydown` real, para no contar dos veces una pulsación. */
  const teclaFisicaAt = useRef(0);
  const [ready, setReady] = useState(false);

  const readOnly = fileMeta?.readOnly ?? false;

  /* ── Power Mode ──────────────────────────────────────────────── */

  useEffect(() => {
    if (!canvasRef.current || !surfaceRef.current) return;

    const fx = new PowerModeFX(canvasRef.current);
    fxRef.current = fx;

    const observer = new ResizeObserver(([entry]) => {
      fx.resize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(surfaceRef.current);

    return () => {
      observer.disconnect();
      fx.dispose();
      fxRef.current = null;
    };
  }, []);

  // El modo rendimiento y `prefers-reduced-motion` apagan los efectos. Se
  // consulta la media query además del ajuste: el sistema manda aunque el
  // usuario no haya tocado nada en la app.
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (fxRef.current) fxRef.current.enabled = !performanceMode && !reduced;
  }, [performanceMode]);

  // El combo alimenta la intensidad de las partículas: cuanto mejor va la
  // racha, más vistoso es escribir. `PowerModeFX` ya exponía el multiplicador
  // desde la Fase 5 esperando exactamente esto.
  useEffect(() => {
    if (fxRef.current) fxRef.current.intensity = comboMultiplier;
  }, [comboMultiplier]);

  /* ── Sincronización con el runner ────────────────────────────── */

  useEffect(() => {
    if (!activeFile) return;
    if (syncTimer.current) window.clearTimeout(syncTimer.current);

    // 250 ms: escribir no debe recompilar Sandpack en cada tecla.
    syncTimer.current = window.setTimeout(() => {
      void syncFile(activeFile, files[activeFile] ?? '');
    }, 250);

    return () => {
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
    };
  }, [activeFile, files, syncFile]);

  /* ── Decoraciones de daño ────────────────────────────────────── */

  useEffect(() => {
    const editorInstance = editorRef.current;
    const monaco = monacoRef.current;
    if (!editorInstance || !monaco || !activeFile) return;

    const damaged = Object.values(results).filter(
      (result) => !result.passed && result.location?.file === activeFile,
    );

    const decorations = damaged.map((result) => ({
      range: new monaco.Range(result.location!.line, 1, result.location!.endLine ?? result.location!.line, 1),
      options: {
        isWholeLine: true,
        className: result.severity === 'damage' ? 'line-damage' : 'line-warn',
        glyphMarginClassName: 'glyph-damage',
        hoverMessage: { value: result.message },
      },
    }));

    decorationsRef.current ??= editorInstance.createDecorationsCollection();
    decorationsRef.current.set(decorations);

    // La sacudida acompaña al daño nuevo, no a cada re-render.
    if (damaged.some((result) => result.severity === 'damage') && surfaceRef.current) {
      fxRef.current?.shake(surfaceRef.current);
    }
  }, [results, activeFile]);

  /* ── Foco del paso ───────────────────────────────────────────── */

  useEffect(() => {
    if (!editorRef.current || !focusLines) return;
    editorRef.current.revealLinesInCenterIfOutsideViewport(focusLines[0], focusLines[1]);
  }, [focusLines, activeFile]);

  /* ── Montaje ─────────────────────────────────────────────────── */

  const handleMount: OnMount = useCallback((instance, monaco) => {
    editorRef.current = instance;
    monacoRef.current = monaco;
    // El runner de TypeScript usa este mismo compilador: ver `monaco-bridge`.
    setMonaco(monaco);
    setReady(true);

    /** Cuenta la pulsación y, si suma combo, emite partículas en el cursor. */
    const celebrar = (key: string, options: { repeat?: boolean } = {}) => {
      const before = useGameStore.getState().combo.count;

      registerKeystroke(key, options);
      if (useGameStore.getState().combo.count === before) return;

      scheduleTypeCheck();

      const position = instance.getPosition();
      if (!position) return;
      const point = instance.getScrolledVisiblePosition(position);
      if (!point) return;

      fxRef.current?.burst(point.left, point.top + point.height / 2);
    };

    instance.onKeyDown((event) => {
      teclaFisicaAt.current = Date.now();
      celebrar(event.browserEvent.key, { repeat: event.browserEvent.repeat });
    });

    /*
     * El camino del teclado virtual.
     *
     * En una tablet no llega la tecla en `keydown`: el texto entra por
     * composición y el navegador reporta `Unidentified` o `Process`, que
     * `isProductiveKey` descarta —con razón, no son caracteres—. El efecto era
     * que en táctil desaparecía media aplicación: sin combo, sin partículas y
     * sin sonido, escribiendo exactamente igual que en un portátil.
     *
     * Se cuenta entonces el mismo hecho donde sí llega: el texto que entra en
     * el modelo. Con tres cautelas, porque no todo cambio es una pulsación:
     *
     * - `isFlush` es un `setValue` —restaurar el buffer, reiniciar el
     *   ejercicio—, y nadie ha tecleado nada.
     * - Si acaba de haber un `keydown` real, ya está contado: en un teclado
     *   físico llegan los dos eventos por la misma tecla.
     * - Un pegado no es teclear. Solo cuenta lo que cabe en una pulsación: un
     *   carácter (o dos, si Monaco cierra el paréntesis), un borrado, o un
     *   salto de línea con su sangrado.
     *
     * Se usa este evento y no `onDidType`, que existe en el runtime de Monaco
     * pero no en su API pública: lo no declarado desaparece sin aviso en una
     * actualización, y con ello volvería a irse el táctil entero.
     */
    instance.onDidChangeModelContent((event) => {
      if (event.isFlush) return;
      if (Date.now() - teclaFisicaAt.current < 60) return;

      for (const cambio of event.changes) {
        const texto = cambio.text;
        if (texto === '') {
          if (cambio.rangeLength > 0) celebrar('Backspace');
        } else if (texto.startsWith('\n') || texto.startsWith('\r')) {
          celebrar('Enter');
        } else if ([...texto].length <= 2) {
          celebrar(texto.slice(-1));
        }
      }
    });

    instance.onDidPaste(() => {
      const model = instance.getModel();
      registerPaste(model?.getValue() ?? '');
    });
  }, [registerKeystroke, registerPaste, scheduleTypeCheck]);

  /**
   * Ejecuta y, con la salida ya disponible, evalúa las reglas de fase `run`.
   *
   * El buffer se vuelca al runner ANTES, sin esperar al debounce de 250 ms:
   * pulsar «Ejecutar» justo después de teclear ejecutaba la versión anterior
   * del archivo. El síntoma era desconcertante —un `SyntaxError` sobre código
   * que en pantalla se ve perfecto— porque el runner corría un texto a medias.
   */
  /*
   * El tema del editor se rehace al cambiar de paleta.
   *
   * `defineTheme` con el mismo nombre sustituye la definición y Monaco
   * repinta, así que no hace falta remontar el editor ni perder el estado del
   * buffer. Sin esto, el editor se quedaba con los colores de la paleta que
   * hubiera al montarlo.
   */
  const theme = useLayoutStore((s) => s.theme);
  useEffect(() => {
    if (monacoRef.current) defineMonacoTheme(monacoRef.current);
  }, [theme]);

  // Ejecutar solo juzga lo que depende de haber ejecutado; el veredicto del
  // paso lo pide la tarjeta del reto, que evalúa todas las fases.
  const handleRun = () => runAndEvaluate('run');

  if (!activeFile) {
    return (
      <Panel className="h-full" title="—">
        <p className="text-xs text-[var(--color-ink-faint)]">{t('empty.noLesson')}</p>
      </Panel>
    );
  }

  return (
    <Panel
      className="h-full"
      title={<span className="font-mono normal-case tracking-normal">{activeFile}</span>}
      action={
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={resetWorkspace}
            className="flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] uppercase text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-border-glow)] hover:text-[var(--color-ink)]"
          >
            <RotateCcw size={11} />
            {t('editor.reset')}
          </button>
          <button
            type="button"
            disabled={runnerStatus === 'booting' || runnerStatus === 'running'}
            onClick={() => void handleRun()}
            className="flex items-center gap-1 rounded-md bg-[var(--color-success)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--color-void)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {runnerStatus === 'running' ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Play size={11} />
            )}
            {t('editor.run')}
          </button>
          {/*
            Aquí ya no hay «Validar paso».

            Eran dos botones para una sola decisión —ejecutar y juzgar— en dos
            sitios distintos de la pantalla, y el veredicto aparecía lejos del
            que lo pedía. La evaluación vive ahora en la tarjeta del reto, junto
            a las comprobaciones que devuelve y al botón que lleva al paso
            siguiente. Este panel se queda con lo suyo: escribir y ejecutar.
          */}
        </div>
      }
    >
      <div ref={surfaceRef} className="relative h-full w-full overflow-hidden rounded">
        <Editor
          /*
           * `path` le da al modelo una identidad estable: sin él, Monaco lo
           * crea con una URI anónima y el runner de TypeScript acababa
           * creando **otro** modelo del mismo archivo. Dos copias del mismo
           * `.ts` en el mismo ámbito global son dos declaraciones de todo, y
           * el compilador respondía «No overload matches this call» a una
           * función que no tenía sobrecargas.
           *
           * Y con `path` sobra el `key`: era él quien **remontaba** el editor
           * en cada cambio de archivo, y en ese hueco lo que se escribía se le
           * atribuía al archivo anterior — el contenido de uno acababa dentro
           * del otro. Ahora Monaco cambia de modelo sin destruir nada, que es
           * además lo que conserva el scroll y el deshacer de cada archivo.
           */
          path={activeFile}
          height="100%"
          theme={THEME_NAME}
          language={languageOf(activeFile)}
          value={files[activeFile] ?? ''}
          onChange={(value) => updateFile(activeFile, value ?? '')}
          beforeMount={(monaco) => defineMonacoTheme(monaco)}
          onMount={handleMount}
          loading={
            <div className="flex h-full items-center justify-center">
              <Loader2 size={14} className="animate-spin text-[var(--color-neon)]" />
            </div>
          }
          options={{
            readOnly,
            fontSize: 13,
            fontFamily: 'var(--font-mono), monospace',
            fontLigatures: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            renderLineHighlight: 'line',
            padding: { top: 12, bottom: 12 },
            glyphMargin: true,
            tabSize: 2,
            automaticLayout: true,
            // El asistente de Monaco compite con lo que la lección quiere
            // enseñar: autocompletar `.map(` regala parte del ejercicio.
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            parameterHints: { enabled: false },
          }}
        />

        {/* Sobre el editor y sin capturar el ratón: el canvas es decorativo. */}
        <ComboCounter />

        <canvas
          ref={canvasRef}
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ opacity: ready ? 1 : 0 }}
        />
      </div>
    </Panel>
  );
}
