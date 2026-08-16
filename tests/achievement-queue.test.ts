import assert from 'node:assert/strict';
import test from 'node:test';
import { useGameStore } from '@/stores/useGameStore';
import type { Achievement } from '@/lib/content/types';

/**
 * Un logro se celebra una sola vez.
 *
 * Hay dos fuentes legítimas y ese es justo el problema: el cliente lo
 * desbloquea en cuanto se cumple —para que la celebración sea inmediata— y el
 * servidor lo confirma unos segundos después al guardar el progreso. Sin un
 * embudo común, el usuario veía el mismo aviso dos veces.
 */

const LOGRO: Achievement = {
  id: 'syntax-ninja',
  title: 'Ninja de la sintaxis',
  description: '50 pulsaciones seguidas sin romper el ritmo.',
  icon: '🥷',
  tier: 'silver',
  xpReward: 120,
  trigger: { type: 'combo-reached', value: 50 },
} as unknown as Achievement;

function limpio() {
  useGameStore.setState({ unlocked: [], pending: [] });
}

test('⭐ el mismo logro anunciado dos veces se celebra una', () => {
  limpio();

  const primera = useGameStore.getState().celebrate([LOGRO]);
  // El servidor confirma lo que el cliente ya celebró.
  const segunda = useGameStore.getState().celebrate([LOGRO]);

  assert.equal(primera.length, 1);
  assert.equal(segunda.length, 0, 'el servidor lo volvió a anunciar y se coló');
  assert.equal(useGameStore.getState().pending.length, 1);
  assert.deepEqual(useGameStore.getState().unlocked, ['syntax-ninja']);
});

test('⭐ tampoco se repite mientras el aviso sigue en pantalla', () => {
  limpio();

  useGameStore.getState().celebrate([LOGRO]);
  // Aún sin cerrar: está en la cola, y eso ya cuenta como celebrado.
  assert.equal(useGameStore.getState().celebrate([LOGRO]).length, 0);
  assert.equal(useGameStore.getState().pending.length, 1);
});

test('⭐ cerrar el aviso no lo hace volver', () => {
  limpio();

  useGameStore.getState().celebrate([LOGRO]);
  useGameStore.getState().dismissAchievement(LOGRO.id);
  assert.equal(useGameStore.getState().pending.length, 0);

  // El servidor lo confirma tarde, con el aviso ya cerrado.
  assert.equal(useGameStore.getState().celebrate([LOGRO]).length, 0);
  assert.equal(useGameStore.getState().pending.length, 0);
});

test('un logro distinto sí se celebra', () => {
  limpio();

  useGameStore.getState().celebrate([LOGRO]);
  const otro = { ...LOGRO, id: 'first-steps' } as Achievement;

  assert.equal(useGameStore.getState().celebrate([otro]).length, 1);
  assert.equal(useGameStore.getState().pending.length, 2);
});
