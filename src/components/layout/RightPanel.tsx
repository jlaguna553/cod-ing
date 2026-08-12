'use client';

import { LessonComplete } from '@/components/lesson/LessonComplete';
import { TaskCard } from '@/components/lesson/TaskCard';
import { StepCard } from '@/components/lesson/StepCard';
import { HintCard } from '@/components/lesson/HintCard';
import { InterviewBrief } from '@/components/lesson/InterviewBrief';
import { TestResultList } from '@/components/lesson/TestResultList';

/**
 * Orden del panel: briefing → guía → **reto** → pruebas → pistas.
 *
 * El reto va DESPUÉS de la explicación: se lee el concepto y después se pide
 * aplicarlo. (Se probó al revés, con la tarea arriba del todo, y resultaba
 * confuso encontrarse el encargo antes de saber de qué iba.)
 *
 * El cierre de la lección sí encabeza el panel, pero solo existe cuando ya has
 * terminado: entonces lo que importa es saber por dónde seguir.
 */
export function RightPanel({
  nextLessonId,
  track,
}: {
  nextLessonId: string | null;
  track: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <LessonComplete nextLessonId={nextLessonId} track={track} />
      <InterviewBrief />
      <StepCard />
      <TaskCard />
      <TestResultList />
      <HintCard />
    </div>
  );
}
