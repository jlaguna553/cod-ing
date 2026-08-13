'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { CheckCircle2, Loader2, Play, RotateCcw } from 'lucide-react';
import { useLessonStore } from '@/stores/useLessonStore';
import { useGameStore } from '@/stores/useGameStore';
import { useRunnerStore } from '@/stores/useRunnerStore';
import { useEvaluationStore } from '@/stores/useEvaluationStore';
import { Panel } from '@/components/layout/GameShell';
import { PowerModeFX } from './PowerModeFX';
import { defineMonacoTheme, languageOf, THEME_NAME } from './monaco-theme';
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
  const execute = useRunnerStore((s) => s.execute);
  const syncFile = useRunnerStore((s) => s.syncFile);

  const evaluate = useEvaluationStore((s) => s.evaluate);
  const scheduleTypeCheck = useEvaluationStore((s) => s.scheduleTypeCheck);
  const stepPassed = useEvaluationStore((s) => s.stepPassed);
  const results = useEvaluationStore((s) => s.results);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<PowerModeFX | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const syncTimer = useRef<number | null>(null);
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
    setReady(true);

    // Emitir partículas en la posición real del cursor dentro del editor.
    instance.onKeyDown((event) => {
      const key = event.browserEvent.key;
      const before = useGameStore.getState().combo.count;

      registerKeystroke(key, { repeat: event.browserEvent.repeat });
      if (useGameStore.getState().combo.count === before) return;

      scheduleTypeCheck();

      const position = instance.getPosition();
      if (!position) return;
      const point = instance.getScrolledVisiblePosition(position);
      if (!point) return;

      fxRef.current?.burst(point.left, point.top + point.height / 2);
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
  const handleRun = async () => {
    const current = useLessonStore.getState().files;
    await Promise.all(
      Object.entries(current).map(([path, content]) => syncFile(path, content)),
    );

    await execute();
    evaluate('run');
  };

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
            Deshabilitado durante la ejecución, igual que «Ejecutar».

            Las reglas que miran el DOM leen un espejo del documento que solo
            existe cuando la ejecución termina. Validar antes las deja en gris
            —«pendiente»— sobre un código que en realidad está bien, y el
            usuario no tiene forma de saber que solo le faltaba esperar.
          */}
          <button
            type="button"
            disabled={runnerStatus === 'booting' || runnerStatus === 'running'}
            onClick={() => evaluate()}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold uppercase transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{
              backgroundColor: stepPassed ? 'var(--color-success)' : 'var(--color-neon)',
              color: 'var(--color-void)',
            }}
          >
            {stepPassed ? <CheckCircle2 size={11} /> : <Play size={11} className="rotate-90" />}
            {t('editor.submit')}
          </button>
        </div>
      }
    >
      <div ref={surfaceRef} className="relative h-full w-full overflow-hidden rounded">
        <Editor
          key={activeFile}
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
