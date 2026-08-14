import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { GameShell } from '@/components/layout/GameShell';
import { LessonComplete } from '@/components/lesson/LessonComplete';
import { OutputDock } from '@/components/layout/OutputDock';
import { CodeCanvas } from '@/components/editor/CodeCanvas';
import { LessonBoot } from '@/components/lesson/LessonBoot';
import { AchievementToast } from '@/components/gamification/AchievementToast';
import { AchievementWatcher } from '@/components/gamification/AchievementWatcher';
import { ProgressSync } from '@/components/system/ProgressSync';
import {
  getAchievements,
  getLessonRouteParams,
  getLocalizedLesson,
  getNextLessonId,
} from '@/lib/content/loader';
import { routing } from '@/i18n/routing';
import type { Track } from '@/lib/content/types';

type PlayParams = { params: Promise<{ locale: string; track: Track; lesson: string }> };

/** Cada lección × cada idioma, prerenderizado en build. */
export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    getLessonRouteParams().map((route) => ({ locale, ...route })),
  );
}

export async function generateMetadata({ params }: PlayParams) {
  const { locale, lesson: lessonId } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const lesson = getLocalizedLesson(lessonId, locale);
  return lesson ? { title: lesson.title, description: lesson.summary } : {};
}

export default async function PlayPage({ params }: PlayParams) {
  const { locale, track, lesson: lessonId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const lesson = getLocalizedLesson(lessonId, locale);
  // 404 también si la lección existe pero cuelga de otro track: evita que
  // /play/frontend/docker-07-layer-cache sea una URL válida y duplicada.
  if (!lesson || lesson.track !== track) notFound();

  return (
    <>
      {/* Empuja la lección ya localizada al store antes de que rendericen los paneles. */}
      <LessonBoot lesson={lesson} />
      <AchievementToast />
      <AchievementWatcher catalog={getAchievements()} />
      <ProgressSync />
      <GameShell
        track={track}
        editor={<CodeCanvas />}
        output={<OutputDock runtimeKind={lesson.runtime.kind} />}
        complete={<LessonComplete nextLessonId={getNextLessonId(lessonId)} track={track} />}
      />
    </>
  );
}
