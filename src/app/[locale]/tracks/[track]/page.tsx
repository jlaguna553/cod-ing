import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { ArrowLeft, CheckCircle2, Circle, Lock, PlayCircle } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { LocaleSwitch } from '@/components/i18n/LocaleSwitch';
import { routing } from '@/i18n/routing';
import { getAllLessons, getLesson } from '@/lib/content/loader';
import { buildTrackMap, nextRecommended, type LessonState } from '@/lib/content/progression';
import { getUserId } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { getTrackProgress } from '@/lib/db/queries';
import type { Locale, Track } from '@/lib/content/types';

const TRACKS: Track[] = ['frontend', 'backend', 'devops'];

const TRACK_COLOR: Record<Track, string> = {
  frontend: 'var(--color-track-frontend)',
  backend: 'var(--color-track-backend)',
  devops: 'var(--color-track-devops)',
};

type TrackParams = { params: Promise<{ locale: string; track: Track }> };

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => TRACKS.map((track) => ({ locale, track })));
}

/**
 * Mapa de mundos de un track.
 *
 * Se renderiza en el servidor leyendo el progreso directamente de la base de
 * datos: es una pantalla de solo lectura y no gana nada pasando por una API.
 * Eso la hace dinámica, a diferencia de las lecciones, que sí se prerenderizan.
 */
export default async function TrackPage({ params }: TrackParams) {
  const { locale, track } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  if (!TRACKS.includes(track)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations();
  const lessons = getAllLessons(locale as Locale).filter((lesson) => lesson.track === track);

  if (lessons.length === 0) {
    return (
      <EmptyTrack track={track} title={t(`tracks.${track}.name`)} back={t('nav.home')} soon={t('tracks.empty')} />
    );
  }

  // El progreso es opcional: sin sesión, el mapa se ve igualmente.
  const userId = await getUserId();
  const progress = userId
    ? (await getTrackProgress(await getDb(), userId))
        .filter((row) => row.track === track)
        .map((row) => ({
          lessonId: row.lessonId,
          status: row.status,
          xpEarned: row.xpEarned,
        }))
    : [];

  const xpByLesson = Object.fromEntries(
    lessons.map((lesson) => [lesson.id, getLesson(lesson.id)?.reward.baseXp ?? 0]),
  );

  const groups = buildTrackMap(lessons, progress, xpByLesson);
  const next = nextRecommended(groups);
  const color = TRACK_COLOR[track];

  const totalCompleted = groups.reduce((sum, group) => sum + group.completed, 0);
  const totalLessons = groups.reduce((sum, group) => sum + group.total, 0);

  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-3">
        <Link
          href="/"
          className="flex w-fit items-center gap-1.5 text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
        >
          <ArrowLeft size={13} />
          {t('nav.home')}
        </Link>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold" style={{ color }}>
              {t(`tracks.${track}.name`)}
            </h1>
            <p className="mt-1 max-w-xl text-sm text-[var(--color-ink-dim)]">
              {t(`tracks.${track}.description`)}
            </p>
          </div>

          {/* El selector va en TODAS las pantallas: quedarse sin él a mitad de
              navegación obliga a editar la URL a mano para volver al idioma. */}
          <div className="w-36 shrink-0">
            <LocaleSwitch />
          </div>

          {next && (
            <Link
              href={`/play/${track}/${next.lesson.id}`}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-void)]"
              style={{ backgroundColor: color }}
            >
              <PlayCircle size={14} />
              {totalCompleted > 0 ? t('home.continue') : t('home.start')}
            </Link>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-abyss)]">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${totalLessons === 0 ? 0 : (totalCompleted / totalLessons) * 100}%`,
                backgroundColor: color,
              }}
            />
          </div>
          <span className="font-mono text-xs text-[var(--color-ink-faint)]">
            {totalCompleted}/{totalLessons}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.module}>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-mono text-xs uppercase tracking-widest" style={{ color }}>
                {group.module}
              </h2>
              <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">
                {group.completed}/{group.total}
              </span>
            </div>

            <ol className="flex flex-col gap-1.5">
              {group.lessons.map((node) => (
                <li key={node.lesson.id}>
                  <LessonRow
                    href={`/play/${track}/${node.lesson.id}`}
                    state={node.state}
                    title={node.lesson.title}
                    summary={node.lesson.summary}
                    kind={t(`lessonKind.${node.lesson.kind}`)}
                    difficulty={t(`difficulty.${node.lesson.difficulty}`)}
                    minutes={node.lesson.estimatedMinutes}
                    xp={xpByLesson[node.lesson.id] ?? 0}
                    lockedLabel={
                      node.missingPrerequisites.length > 0
                        ? t('tracks.locked', { count: node.missingPrerequisites.length })
                        : undefined
                    }
                    color={color}
                  />
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

function LessonRow({
  href,
  state,
  title,
  summary,
  kind,
  difficulty,
  minutes,
  xp,
  lockedLabel,
  color,
}: {
  href: string;
  state: LessonState;
  title: string;
  summary: string;
  kind: string;
  difficulty: string;
  minutes: number;
  xp: number;
  lockedLabel?: string;
  color: string;
}) {
  const icon =
    state === 'completed' ? (
      <CheckCircle2 size={16} style={{ color: 'var(--color-success)' }} />
    ) : state === 'locked' ? (
      <Lock size={15} className="text-[var(--color-ink-faint)]" />
    ) : state === 'in-progress' ? (
      <PlayCircle size={16} style={{ color: 'var(--color-power)' }} />
    ) : (
      <Circle size={15} className="text-[var(--color-ink-faint)]" />
    );

  const body = (
    <div
      className={
        'flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2.5 transition-colors ' +
        (state === 'locked' ? 'opacity-50' : 'hover:border-[var(--color-border-glow)]')
      }
    >
      <span className="mt-0.5 shrink-0">{icon}</span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--color-ink)]">{title}</p>
        <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-ink-dim)]">{summary}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Tag>{kind}</Tag>
          <Tag>{difficulty}</Tag>
          <Tag>{minutes} min</Tag>
          {lockedLabel && <Tag>{lockedLabel}</Tag>}
        </div>
      </div>

      <span className="shrink-0 font-mono text-[10px]" style={{ color }}>
        {xp} XP
      </span>
    </div>
  );

  // Una lección bloqueada no es un enlace: dejar pulsar y llegar a algo que no
  // se puede resolver es peor que no dejar pulsar.
  return state === 'locked' ? body : <Link href={href}>{body}</Link>;
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-[var(--color-border)] bg-[var(--color-abyss)] px-1.5 py-0.5 font-mono text-[9px] uppercase text-[var(--color-ink-faint)]">
      {children}
    </span>
  );
}

function EmptyTrack({
  track,
  title,
  back,
  soon,
}: {
  track: Track;
  title: string;
  back: string;
  soon: string;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col items-start gap-4 px-6 py-12">
      <Link href="/" className="flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)]">
        <ArrowLeft size={13} />
        {back}
      </Link>
      <h1 className="text-3xl font-bold" style={{ color: TRACK_COLOR[track] }}>
        {title}
      </h1>
      <p className="text-sm text-[var(--color-ink-dim)]">{soon}</p>
      <div className="w-36">
        <LocaleSwitch />
      </div>
    </div>
  );
}
