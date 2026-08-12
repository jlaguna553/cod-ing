'use client';

import { useTranslations } from 'next-intl';
import { Files, Trophy, Zap } from 'lucide-react';
import { Panel } from './GameShell';
import { LocaleSwitch } from '@/components/i18n/LocaleSwitch';
import { SessionMeter } from '@/components/gamification/SessionMeter';
import { FileTree } from '@/components/editor/FileTree';
import { useLessonStore } from '@/stores/useLessonStore';

export function LeftPanel() {
  const t = useTranslations();
  const lesson = useLessonStore((s) => s.lesson);

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

      <Panel title={<span className="flex items-center gap-2"><Files size={13} /> {t('panels.files')}</span>}>
        <FileTree />
      </Panel>

      <Panel title={<span className="flex items-center gap-2"><Trophy size={13} /> {t('panels.achievements')}</span>}>
        <p className="text-xs text-[var(--color-ink-faint)]">
          {t('achievements.progress', { unlocked: 0, total: lesson?.reward.achievements.length ?? 0 })}
        </p>
      </Panel>

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
