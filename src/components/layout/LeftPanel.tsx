'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, Files, Trophy, Zap } from 'lucide-react';
import { Panel } from './GameShell';
import { LocaleSwitch } from '@/components/i18n/LocaleSwitch';
import { SessionMeter } from '@/components/gamification/SessionMeter';
import { FileTree } from '@/components/editor/FileTree';
import { useLessonStore, useVisibleFiles } from '@/stores/useLessonStore';

export function LeftPanel() {
  const t = useTranslations();
  const lesson = useLessonStore((s) => s.lesson);
  const files = useVisibleFiles();

  /*
   * El árbol se pliega solo cuando no hay nada que recorrer.
   *
   * Con un único archivo y sin permiso para crear otros, la lista es una fila
   * que repite lo que ya dice el título del editor. Ocupaba un panel entero
   * del lateral para no aportar nada. Se pliega, pero no desaparece: sigue
   * pudiendo abrirse, y basta que la lección tenga dos archivos —o permita
   * crearlos— para que vuelva a salir desplegada.
   */
  const treeIsUseful = files.length > 1 || lesson?.workspace.allowCreate === true;
  const [showFiles, setShowFiles] = useState(treeIsUseful);
  useEffect(() => setShowFiles(treeIsUseful), [treeIsUseful, lesson?.id]);

  const achievements = lesson?.reward.achievements.length ?? 0;

  return (
    <>
      <Panel title={<span className="flex items-center gap-2"><Zap size={13} /> {t('meta.appName')}</span>}>
        <SessionMeter />
      </Panel>

      {lesson && (
        <div className="rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
          <p className="text-sm font-semibold leading-tight text-[var(--color-ink)]">
            {lesson.title}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>{t(`lessonKind.${lesson.kind}`)}</Badge>
            <Badge>{t(`difficulty.${lesson.difficulty}`)}</Badge>
            <Badge>{lesson.estimatedMinutes} min</Badge>
          </div>
        </div>
      )}

      <Panel
        title={<span className="flex items-center gap-2"><Files size={13} /> {t('panels.files')}</span>}
        action={
          <button
            type="button"
            onClick={() => setShowFiles((value) => !value)}
            aria-expanded={showFiles}
            className="flex items-center gap-1.5 text-[10px] text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
          >
            <span className="font-mono">
              {files.length === 1 ? t('files.single') : t('files.count', { count: files.length })}
            </span>
            {showFiles ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
        }
      >
        {showFiles && <FileTree />}
      </Panel>

      {/* Sin logros que ganar, el panel solo decía «0 de 0». */}
      {achievements > 0 && (
        <Panel title={<span className="flex items-center gap-2"><Trophy size={13} /> {t('panels.achievements')}</span>}>
          <p className="text-xs text-[var(--color-ink-faint)]">
            {t('achievements.progress', { unlocked: 0, total: achievements })}
          </p>
        </Panel>
      )}

      <div className="rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
        <LocaleSwitch />
      </div>
    </>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-[var(--color-border)] bg-[var(--color-abyss)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--color-ink-faint)]">
      {children}
    </span>
  );
}
