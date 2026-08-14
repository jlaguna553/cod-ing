'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, Files, Trophy, Zap } from 'lucide-react';
import type { WidgetId } from '@/stores/useLayoutStore';
import { Panel } from './GameShell';
import { SessionMeter } from '@/components/gamification/SessionMeter';
import { FileTree } from '@/components/editor/FileTree';
import { InterviewBrief } from '@/components/lesson/InterviewBrief';
import { StepCard } from '@/components/lesson/StepCard';
import { ChallengeCard } from '@/components/lesson/ChallengeCard';
import { useLessonStore, useVisibleFiles } from '@/stores/useLessonStore';

/**
 * Registro único de tarjetas movibles.
 *
 * Cada una se declara aquí una sola vez —su nombre para el menú y qué pinta— y
 * las zonas las componen leyendo la disposición del usuario. Añadir una tarjeta
 * nueva es añadir una entrada; ni el layout ni el modo de edición cambian.
 *
 * El editor y la salida **no** están: son el escenario, no decoración. Se
 * redimensionan pero no se mueven ni se ocultan, porque una pantalla sin editor
 * no es una pantalla personalizada, es una pantalla rota.
 */

/**
 * Qué tarjetas tienen sentido en ESTA lección.
 *
 * Sin esto, el modo edición enseñaba un hueco titulado «Briefing de entrevista»
 * en una lección que no es de entrevista: la tarjeta se pintaba vacía y su asa
 * de arrastre seguía ahí. Anunciar algo que no existe confunde más que
 * ocultarlo.
 */
export function useAvailableWidgets(): Set<WidgetId> {
  const lesson = useLessonStore((s) => s.lesson);

  const disponibles = new Set<WidgetId>(['session', 'files', 'guide', 'challenge']);

  if (lesson?.interview) disponibles.add('brief');
  if ((lesson?.reward.achievements.length ?? 0) > 0) disponibles.add('achievements');

  return disponibles;
}

export function useWidgetLabels(): Record<WidgetId, string> {
  const t = useTranslations();
  return {
    session: t('meta.appName'),
    files: t('panels.files'),
    achievements: t('panels.achievements'),
    brief: t('interview.brief'),
    guide: t('panels.guide'),
    challenge: t('steps.task'),
  };
}

/** Pinta una tarjeta por su id. Devuelve `null` si no aplica a esta lección. */
export function Widget({ id }: { id: WidgetId }) {
  switch (id) {
    case 'session':
      return <SessionWidget />;
    case 'files':
      return <FilesWidget />;
    case 'achievements':
      return <AchievementsWidget />;
    case 'brief':
      return <InterviewBrief />;
    case 'guide':
      return <StepCard />;
    case 'challenge':
      return <ChallengeCard />;
    default:
      return null;
  }
}

function SessionWidget() {
  const t = useTranslations();
  return (
    <Panel title={<span className="flex items-center gap-2"><Zap size={13} /> {t('meta.appName')}</span>}>
      <SessionMeter />
    </Panel>
  );
}

function FilesWidget(): ReactNode {
  const t = useTranslations();
  const files = useVisibleFiles();
  const allowCreate = useLessonStore((s) => s.lesson?.workspace.allowCreate === true);

  /*
   * El árbol se pliega solo cuando no hay nada que recorrer.
   *
   * Con un único archivo y sin permiso para crear otros, la lista es una fila
   * que repite lo que ya dice el título del editor. Es automático y por lección;
   * ocultar la tarjeta entera desde «Personalizar» es manual y por usuario. Las
   * dos cosas sirven, y ninguna sustituye a la otra.
   */
  const utilizable = files.length > 1 || allowCreate;
  const [abierto, setAbierto] = useState(utilizable);
  useEffect(() => setAbierto(utilizable), [utilizable]);

  return (
    <Panel
      title={<span className="flex items-center gap-2"><Files size={13} /> {t('panels.files')}</span>}
      action={
        <button
          type="button"
          onClick={() => setAbierto((valor) => !valor)}
          aria-expanded={abierto}
          className="flex items-center gap-1.5 text-[10px] text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
        >
          <span className="font-mono">
            {files.length === 1 ? t('files.single') : t('files.count', { count: files.length })}
          </span>
          {abierto ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
      }
    >
      {abierto && <FileTree />}
    </Panel>
  );
}

function AchievementsWidget(): ReactNode {
  const t = useTranslations();
  const total = useLessonStore((s) => s.lesson?.reward.achievements.length ?? 0);

  // Sin logros que ganar, la tarjeta solo diría «0 de 0».
  if (total === 0) return null;

  return (
    <Panel title={<span className="flex items-center gap-2"><Trophy size={13} /> {t('panels.achievements')}</span>}>
      <p className="text-xs text-[var(--color-ink-faint)]">
        {t('achievements.progress', { unlocked: 0, total })}
      </p>
    </Panel>
  );
}
