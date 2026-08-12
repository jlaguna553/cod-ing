'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Gauge, Volume2, Zap } from 'lucide-react';
import { SOUND_PACKS, type SoundPack } from '@/lib/audio/packs';
import { useGameStore } from '@/stores/useGameStore';

/**
 * HUD del jugador: nivel, XP, energía, pulsaciones y ajustes de audio.
 *
 * Sigue siendo también la prueba visible del ADR-01: todo esto vive en un
 * store de módulo, así que sobrevive al remonte que provoca el cambio de
 * idioma.
 */
export function SessionMeter() {
  const t = useTranslations();

  const level = useGameStore((s) => s.level);
  const energy = useGameStore((s) => s.energy);
  const keystrokes = useGameStore((s) => s.keystrokes);
  const bestCombo = useGameStore((s) => s.stats.bestCombo);
  const performanceMode = useGameStore((s) => s.performanceMode);
  const setPerformanceMode = useGameStore((s) => s.setPerformanceMode);
  const soundPack = useGameStore((s) => s.soundPack);
  const setSoundPack = useGameStore((s) => s.setSoundPack);
  const volume = useGameStore((s) => s.volume);
  const setVolume = useGameStore((s) => s.setVolume);

  // El valor persistido solo existe en cliente: pintarlo antes de hidratar
  // produciría un desajuste entre servidor y navegador.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="flex items-center gap-2 text-xs text-[var(--color-ink-dim)]">
          <Gauge size={13} />
          {t('hud.level', { level: level.level })}
        </span>
        <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">
          {t('hud.xp', { current: level.current, next: level.needed })}
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-abyss)]">
        <div
          className="h-full rounded-full bg-[var(--color-neon)] transition-[width] duration-500"
          style={{ width: `${Math.round(level.progress * 100)}%` }}
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
          <span className="flex items-center gap-1.5">
            <Zap size={10} />
            {t('hud.energy')}
          </span>
          <span className="font-mono">{Math.round(energy)}%</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-[var(--color-abyss)]">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${energy}%`,
              backgroundColor:
                energy > 50
                  ? 'var(--color-success)'
                  : energy > 20
                    ? 'var(--color-power)'
                    : 'var(--color-damage)',
            }}
          />
        </div>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="font-mono text-2xl tabular-nums text-[var(--color-neon)] text-glow">
            {mounted ? keystrokes.toLocaleString() : '—'}
          </p>
          <p className="-mt-1 text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
            {t('hud.keystrokes', { count: '' }).trim()}
          </p>
        </div>
        {mounted && bestCombo > 0 && (
          <p className="font-mono text-[10px] text-[var(--color-ink-faint)]">
            {t('hud.bestCombo', { count: bestCombo })}
          </p>
        )}
      </div>

      {/* ── Audio ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5 border-t border-[var(--color-border)] pt-3">
        <label
          htmlFor="sound-pack"
          className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]"
        >
          <Volume2 size={11} />
          {t('sound.pack')}
        </label>

        <select
          id="sound-pack"
          value={soundPack}
          onChange={(event) => setSoundPack(event.target.value as SoundPack)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-abyss)] px-2 py-1.5 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-neon)]"
        >
          {SOUND_PACKS.map((pack) => (
            <option key={pack} value={pack}>
              {t(`sound.packs.${pack}`)}
            </option>
          ))}
        </select>

        {soundPack !== 'silent' && (
          <label className="flex items-center gap-2">
            <span className="sr-only">{t('sound.volume')}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(event) => setVolume(Number(event.target.value) / 100)}
              className="h-1 w-full accent-[var(--color-neon)]"
              aria-label={t('sound.volume')}
            />
          </label>
        )}
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-ink-dim)]">
        <input
          type="checkbox"
          checked={performanceMode}
          onChange={(event) => setPerformanceMode(event.target.checked)}
          className="size-3.5 accent-[var(--color-neon)]"
        />
        <span title={t('editor.performanceModeHint')}>{t('editor.performanceMode')}</span>
      </label>
    </div>
  );
}
