'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useGameStore } from '@/stores/useGameStore';

/**
 * Contador de combo flotante.
 *
 * Se monta sobre el editor, alineado a la derecha, y solo aparece a partir del
 * primer tramo: mostrar «1x» en cada pulsación sería ruido constante en vez de
 * una recompensa.
 */
export function ComboCounter() {
  const t = useTranslations();
  const combo = useGameStore((s) => s.combo);
  const refreshCombo = useGameStore((s) => s.refreshCombo);
  const performanceMode = useGameStore((s) => s.performanceMode);

  const [popping, setPopping] = useState(false);
  const previousCount = useRef(0);

  // El decay tiene que verse aunque el usuario deje de teclear: sin este
  // latido, el combo se quedaría congelado en pantalla para siempre.
  useEffect(() => {
    const timer = window.setInterval(refreshCombo, 400);
    return () => window.clearInterval(timer);
  }, [refreshCombo]);

  useEffect(() => {
    if (combo.count > previousCount.current && !performanceMode) {
      setPopping(true);
      const timer = window.setTimeout(() => setPopping(false), 200);
      return () => window.clearTimeout(timer);
    }
    previousCount.current = combo.count;
  }, [combo.count, performanceMode]);

  if (combo.count < 10) return null;

  const color =
    combo.multiplier >= 3
      ? 'var(--color-damage)'
      : combo.multiplier >= 2
        ? 'var(--color-neon-alt)'
        : 'var(--color-power)';

  return (
    <div
      className={`pointer-events-none absolute right-3 top-3 z-10 flex flex-col items-end ${popping ? 'combo-pop' : ''}`}
      aria-live="polite"
    >
      <span className="font-mono text-2xl font-bold tabular-nums text-glow" style={{ color }}>
        {combo.multiplier}×
      </span>
      <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color }}>
        {t('hud.combo', { count: combo.count })}
      </span>
      {combo.label && (
        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color }}>
          {t(`combo.${combo.label}`)}
        </span>
      )}
    </div>
  );
}
