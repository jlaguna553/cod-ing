'use client';

import { LessonComplete } from '@/components/lesson/LessonComplete';
import { TaskCard } from '@/components/lesson/TaskCard';
import { StepCard } from '@/components/lesson/StepCard';
import { StepNav } from '@/components/lesson/StepNav';
import { InterviewBrief } from '@/components/lesson/InterviewBrief';
import { TestResultList } from '@/components/lesson/TestResultList';

/**
 * Panel de lección en tres zonas, con un solo punto de scroll.
 *
 *   ┌────────────────────────────┐
 *   │ SCROLL  guía               │  ← lo único que se desplaza
 *   ├────────────────────────────┤
 *   │ FIJO    reto + progreso    │  ← qué hay que hacer, nunca se va
 *   │           └ pistas         │     la ayuda, donde ya estás mirando
 *   │         navegación         │
 *   │         pruebas            │  ← en qué se está fallando, siempre visible
 *   └────────────────────────────┘
 *
 * Antes el panel entero era una columna con scroll único: el reto se iba por
 * arriba en cuanto empezabas a leer, y el resultado de las pruebas quedaba
 * debajo de varios párrafos justo cuando más falta hacía —al corregir—. Las
 * dos piezas que se consultan *mientras* se escribe código son precisamente
 * esas, así que son las que no se mueven; el texto explicativo, que se lee una
 * vez, es el que cede el desplazamiento.
 *
 * El reto queda **debajo** de la guía y no encima: se lee el concepto y
 * después se pide aplicarlo. Se probó al revés y resultaba confuso encontrarse
 * el encargo antes de saber de qué iba. Fijarlo no cambia ese orden — lo que
 * cambia es que ya no se pierde al desplazarse.
 *
 * `min-h-0` en la zona de scroll no es decorativo: sin él, una guía larga
 * estira el grid y empuja las pruebas fuera de la pantalla, que es justo lo
 * que este layout viene a evitar.
 *
 * Solo dos filas, y las dos existen siempre. Con una tercera para el cierre de
 * lección el grid se descolocaba: `LessonComplete` devuelve `null` mientras la
 * lección está en curso, así que no ocupaba fila, la zona de scroll heredaba
 * la fila `auto` —creciendo hasta su contenido— y el bloque fijo se quedaba
 * con cero de alto, fuera de la pantalla. Las filas implícitas se reparten por
 * elementos renderizados, no por elementos escritos.
 */
export function RightPanel({
  nextLessonId,
  track,
}: {
  nextLessonId: string | null;
  track: string;
}) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        <InterviewBrief />
        <StepCard />
      </div>

      <div className="flex flex-col gap-3">
        {/* Solo existe al terminar; entonces lo que importa es por dónde seguir. */}
        <LessonComplete nextLessonId={nextLessonId} track={track} />
        <TaskCard />
        <StepNav />
        <TestResultList />
      </div>
    </div>
  );
}
