'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/stores/useGameStore';
import { useLessonStore } from '@/stores/useLessonStore';

const AUTOSAVE_MS = 2500;

/**
 * Puente entre el estado local y el servidor.
 *
 * **Carga:** al entrar en una lección pide su progreso y restaura el buffer y
 * el paso. Es lo que permite cerrar el portátil a media lección y seguir en
 * otro sitio.
 *
 * **Guardado:** autosave con debounce de 2,5 s. Guardar en cada pulsación
 * sería una petición cada 80 ms; guardar solo al salir perdería el trabajo si
 * el navegador se cierra de golpe. 2,5 s acota la pérdida a una frase.
 *
 * Los logros que devuelve el servidor se muestran igual que los locales: el
 * servidor es la autoridad, el cliente solo celebra.
 */
export function ProgressSync() {
  const lessonId = useLessonStore((s) => s.lesson?.id ?? null);
  const stepIndex = useLessonStore((s) => s.stepIndex);
  const files = useLessonStore((s) => s.files);
  const revealedHints = useLessonStore((s) => s.revealedHints);

  const keystrokes = useGameStore((s) => s.keystrokes);
  const bestCombo = useGameStore((s) => s.stats.bestCombo);

  const timer = useRef<number | null>(null);
  const loadedFor = useRef<string | null>(null);

  /* ── Carga ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!lessonId || loadedFor.current === lessonId) return;
    loadedFor.current = lessonId;

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`/api/progress?lesson=${encodeURIComponent(lessonId)}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;

        const data = (await response.json()) as {
          progress: { stepIndex: number; codeSnapshot: Record<string, string> | null } | null;
        };
        if (!data.progress?.codeSnapshot) return;

        // Solo se restaura si el usuario no ha empezado a escribir ya: pisarle
        // lo que acaba de teclear sería peor que no restaurar nada.
        const store = useLessonStore.getState();
        if (store.dirtyFiles.length > 0) return;

        for (const [path, content] of Object.entries(data.progress.codeSnapshot)) {
          store.updateFile(path, content);
        }
        store.goToStep(data.progress.stepIndex);
      } catch {
        // Sin conexión se sigue jugando en local; el progreso se guardará luego.
      }
    })();

    return () => controller.abort();
  }, [lessonId]);

  /* ── Autosave ──────────────────────────────────────────────────── */
  useEffect(() => {
    if (!lessonId) return;
    if (timer.current) window.clearTimeout(timer.current);

    timer.current = window.setTimeout(() => {
      void fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId,
          stepIndex,
          hintsUsed: revealedHints.length,
          damageTaken: 0,
          codeSnapshot: files,
          keystrokes,
          bestCombo,
        }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { achievements?: unknown[] } | null) => {
          if (!data?.achievements?.length) return;
          useGameStore.setState((state) => ({
            pending: [...state.pending, ...(data.achievements as never[])],
          }));
        })
        .catch(() => {
          // Fallo de red: el siguiente autosave reintenta con el estado actual.
        });
    }, AUTOSAVE_MS);

    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [lessonId, stepIndex, files, revealedHints, keystrokes, bestCombo]);

  return null;
}
