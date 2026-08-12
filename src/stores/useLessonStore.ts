import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { ClientLesson, Locale } from '@/lib/content/types';

export type LocalizedLesson = ClientLesson;

interface LessonState {
  lesson: LocalizedLesson | null;
  /** Buffer editable: ruta → contenido. Es la verdad del código del usuario. */
  files: Record<string, string>;
  activeFile: string | null;
  stepIndex: number;
  /** Ids de pistas ya reveladas (cuestan XP, no se re-cobran). */
  revealedHints: string[];
  /** Textos de pistas traídos del servidor: id → texto. */
  hintTexts: Record<string, string>;
  /** Rutas modificadas respecto al contenido inicial. */
  dirtyFiles: string[];
  /**
   * Resultado del cierre de la lección, tal y como lo devolvió el servidor.
   *
   * Su presencia es lo que dispara el panel de «lección completada». Se guarda
   * el XP concedido —no una estimación local— porque repetir una lección ya
   * terminada concede 0 y hay que poder decirlo.
   */
  completion: { xpAwarded: number; alreadyCompleted: boolean } | null;

  syncLesson: (lesson: LocalizedLesson) => void;
  setActiveFile: (path: string) => void;
  updateFile: (path: string, content: string) => void;
  goToStep: (index: number) => void;
  nextStep: () => void;
  previousStep: () => void;
  revealHint: (hintId: string, locale: Locale) => Promise<void>;
  resetWorkspace: () => void;
  setCompletion: (result: { xpAwarded: number; alreadyCompleted: boolean } | null) => void;
}

function initialFiles(lesson: LocalizedLesson): Record<string, string> {
  return Object.fromEntries(lesson.workspace.files.map((f) => [f.path, f.content]));
}

function defaultActiveFile(lesson: LocalizedLesson): string {
  const active = lesson.workspace.files.find((f) => f.active && !f.hidden);
  const firstEditable = lesson.workspace.files.find((f) => !f.hidden && !f.readOnly);
  return active?.path ?? firstEditable?.path ?? lesson.workspace.entry;
}

export const useLessonStore = create<LessonState>()((set, get) => ({
  lesson: null,
  files: {},
  activeFile: null,
  stepIndex: 0,
  revealedHints: [],
  hintTexts: {},
  dirtyFiles: [],
  completion: null,

  /**
   * ⭐ El corazón del ADR-01.
   *
   * Se llama en CADA render del servidor, incluido el que sigue a un cambio
   * de idioma. Si la lección es la misma, sustituye **solo los textos** y deja
   * intactos el buffer de código, el paso actual y las pistas reveladas.
   *
   * Ese `if` es toda la implementación de "cambiar de idioma no reinicia el
   * progreso": el subárbol de React se remonta, el texto cambia, y el trabajo
   * del usuario sigue exactamente donde estaba. Si en su lugar hiciéramos un
   * reset incondicional, cambiar de idioma borraría el código escrito.
   *
   * Idempotente a propósito: se invoca durante el render, y StrictMode lo
   * ejecuta dos veces.
   */
  syncLesson: (lesson) => {
    const current = get().lesson;

    if (current?.id === lesson.id) {
      if (current === lesson) return;
      // Los textos de pistas ya reveladas quedan en el idioma en que se
      // pidieron; se refrescan al idioma nuevo solo si se vuelven a abrir.
      set({ lesson });
      return;
    }

    set({
      lesson,
      files: initialFiles(lesson),
      activeFile: defaultActiveFile(lesson),
      stepIndex: 0,
      revealedHints: [],
      hintTexts: {},
      dirtyFiles: [],
      completion: null,
    });
  },

  setActiveFile: (path) => set({ activeFile: path }),

  updateFile: (path, content) =>
    set((state) => {
      const original = state.lesson?.workspace.files.find((f) => f.path === path)?.content;
      const isDirty = original !== undefined && content !== original;
      const dirtyFiles = isDirty
        ? [...new Set([...state.dirtyFiles, path])]
        : state.dirtyFiles.filter((p) => p !== path);

      return { files: { ...state.files, [path]: content }, dirtyFiles };
    }),

  goToStep: (index) =>
    set((state) => {
      const total = state.lesson?.steps.length ?? 0;
      return { stepIndex: Math.min(Math.max(index, 0), Math.max(total - 1, 0)) };
    }),

  nextStep: () => get().goToStep(get().stepIndex + 1),
  previousStep: () => get().goToStep(get().stepIndex - 1),

  /**
   * Revela una pista pidiendo su texto al servidor.
   *
   * El id se marca como revelado ANTES del fetch (feedback inmediato) pero se
   * revierte si la petición falla, para no cobrar XP por una pista que el
   * usuario nunca llegó a leer.
   */
  revealHint: async (hintId, locale) => {
    const state = get();
    const lessonId = state.lesson?.id;
    if (!lessonId || state.revealedHints.includes(hintId)) return;

    set({ revealedHints: [...state.revealedHints, hintId] });

    try {
      const response = await fetch('/api/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonId, hintId, locale }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const { text } = (await response.json()) as { text: string };
      set((s) => ({ hintTexts: { ...s.hintTexts, [hintId]: text } }));
    } catch {
      set((s) => ({ revealedHints: s.revealedHints.filter((id) => id !== hintId) }));
    }
  },

  setCompletion: (result) => set({ completion: result }),

  resetWorkspace: () =>
    set((state) =>
      state.lesson
        ? { files: initialFiles(state.lesson), dirtyFiles: [] }
        : state,
    ),
}));

/* ── Selectores derivados ─────────────────────────────────────────── */

export const useCurrentStep = () =>
  useLessonStore((s) => (s.lesson ? s.lesson.steps[s.stepIndex] ?? null : null));

/**
 * ⚠️ Los selectores que CONSTRUYEN un valor (filter, map, spread) necesitan
 * `useShallow`.
 *
 * Zustand v5 compara la salida del selector con `Object.is`. Un `.filter()`
 * devuelve un array nuevo en cada llamada, así que sin comparación superficial
 * el componente se considera cambiado siempre y React aborta con «Maximum
 * update depth exceeded». Es exactamente lo que tumbó la página entera hasta
 * que un E2E la abrió en un navegador de verdad.
 */
export const useVisibleFiles = () =>
  useLessonStore(useShallow((s) => s.lesson?.workspace.files.filter((f) => !f.hidden) ?? []));

export const useActiveFileContent = () =>
  useLessonStore((s) => (s.activeFile ? s.files[s.activeFile] ?? '' : ''));

/** Reglas del paso actual, resueltas desde el catálogo de la lección. */
export const useCurrentStepRules = () =>
  useLessonStore(useShallow((s) => {
    const step = s.lesson?.steps[s.stepIndex];
    if (!s.lesson || !step) return [];
    return step.ruleIds
      .map((id) => s.lesson!.rules.find((r) => r.id === id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
  }));
