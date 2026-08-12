'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/stores/useGameStore';
import { getSoundEngine } from '@/lib/audio/engine';

/**
 * Sincroniza los ajustes persistidos con el mundo exterior: el atributo del
 * `<html>` que lee `globals.css` y el motor de audio.
 *
 * También registra el desbloqueo del `AudioContext` en el primer gesto real
 * del usuario. Sin esto el navegador lo mantiene suspendido y el pack elegido
 * parece estropeado.
 */
export function PerformanceModeBoot() {
  const performanceMode = useGameStore((s) => s.performanceMode);
  const soundPack = useGameStore((s) => s.soundPack);
  const volume = useGameStore((s) => s.volume);

  useEffect(() => {
    document.documentElement.dataset.performanceMode = String(performanceMode);
  }, [performanceMode]);

  useEffect(() => {
    const engine = getSoundEngine();
    engine.setPack(soundPack);
    engine.setVolume(volume);
    engine.setMuted(performanceMode);
  }, [soundPack, volume, performanceMode]);

  /**
   * Sonda de audio.
   *
   * El equilibrio entre packs no se puede juzgar de oído de forma fiable: un
   * pack puede sonar bien en unos altavoces y desaparecer en otros. Exponer el
   * renderizador permite medir los seis y detectar desequilibrios — que es el
   * fallo que se coló al subir el volumen del graznido.
   *
   * Se expone también en producción a propósito: solo sintetiza audio en un
   * buffer de memoria —no lee datos ni ejecuta nada— y permite comprobar un
   * pack desde la consola sin desplegar una versión especial.
   */
  useEffect(() => {
    void import('@/lib/audio/engine').then(({ renderPackSample }) => {
      (window as unknown as { __audioProbe?: unknown }).__audioProbe = { renderPackSample };
    });
  }, []);

  useEffect(() => {
    const unlock = () => void getSoundEngine().unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  return null;
}
