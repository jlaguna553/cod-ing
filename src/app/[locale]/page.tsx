import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ChevronRight, Cpu, Flame, Layers, Server } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { LocaleSwitch } from '@/components/i18n/LocaleSwitch';
import { getAllLessons } from '@/lib/content/loader';
import { getUserId } from '@/lib/auth/session';
import { getAccount } from '@/lib/auth/account';
import { AccountCard } from '@/components/account/AccountCard';
import { getDb } from '@/lib/db/client';
import { getStats, getTrackProgress } from '@/lib/db/queries';
import type { Locale, Track } from '@/lib/content/types';

const TRACKS: { id: Track; icon: typeof Layers; color: string }[] = [
  { id: 'frontend', icon: Layers, color: 'var(--color-track-frontend)' },
  { id: 'backend', icon: Server, color: 'var(--color-track-backend)' },
  { id: 'devops', icon: Cpu, color: 'var(--color-track-devops)' },
];

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const lessons = getAllLessons(locale as Locale);

  // Sin sesión la home se ve igual, solo sin progreso: nadie debe encontrarse
  // una pantalla vacía por no haber jugado todavía.
  const userId = await getUserId();
  const [progress, stats, account] = userId
    ? await Promise.all([
        getTrackProgress(await getDb(), userId),
        getStats(await getDb(), userId),
        getAccount(await getDb(), userId),
      ])
    : [[], null, null];

  const completedByTrack = new Map<string, number>();
  for (const row of progress) {
    if (row.status !== 'completed') continue;
    completedByTrack.set(row.track, (completedByTrack.get(row.track) ?? 0) + 1);
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--color-neon)]">
            {t('meta.appName')}
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-[var(--color-ink)]">
            {t('home.title')}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--color-ink-dim)]">{t('home.subtitle')}</p>

          {stats && stats.totalXp > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-[var(--color-ink-dim)]">
              <span className="font-mono">{t('hud.level', { level: stats.level })}</span>
              <span className="font-mono">{stats.totalXp} XP</span>
              {stats.streakDays > 1 && (
                <span className="flex items-center gap-1 font-mono text-[var(--color-power)]">
                  <Flame size={12} />
                  {t('home.streak', { days: stats.streakDays })}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="w-40 shrink-0">
          <LocaleSwitch />
        </div>
      </header>

      <AccountCard email={account?.email ?? null} />

      <div className="grid gap-4 md:grid-cols-3">
        {TRACKS.map(({ id, icon: Icon, color }) => {
          const total = lessons.filter((lesson) => lesson.track === id).length;
          const done = completedByTrack.get(id) ?? 0;

          return (
            <Link
              key={id}
              href={`/tracks/${id}`}
              className="group flex flex-col gap-3 rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-panel)] p-5 transition-colors hover:border-[var(--color-border-glow)]"
            >
              <Icon size={22} style={{ color }} />
              <h2 className="text-lg font-semibold" style={{ color }}>
                {t(`tracks.${id}.name`)}
              </h2>
              <p className="flex-1 text-xs leading-relaxed text-[var(--color-ink-dim)]">
                {t(`tracks.${id}.description`)}
              </p>

              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-abyss)]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${total === 0 ? 0 : (done / total) * 100}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
                <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">
                  {done}/{total}
                </span>
              </div>

              <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-[var(--color-ink-faint)] transition-colors group-hover:text-[var(--color-ink)]">
                {done > 0 ? t('home.continue') : t('home.start')}
                <ChevronRight size={14} />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
