import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  breakCombo,
  COMBO_WINDOW_MS,
  hasExpired,
  initialCombo,
  isCheatPaste,
  isProductiveKey,
  registerHit,
} from '@/lib/game/combo';
import { levelFromXp, lessonXp, xpForLevel } from '@/lib/game/xp';
import {
  emptyStats,
  findNewlyUnlocked,
  isUnlocked,
  progressToward,
  type PlayerStats,
} from '@/lib/game/achievements';
import { AchievementCatalogSchema } from '@/lib/content/lesson.schema';
import { localize } from '@/lib/content/localize';

/* ── Combo ───────────────────────────────────────────────────────── */

function hits(count: number, startAt = 1000, gap = 100) {
  let state = initialCombo;
  for (let index = 0; index < count; index++) {
    state = registerHit(state, startAt + index * gap);
  }
  return state;
}

test('el combo sube y escala el multiplicador por tramos', () => {
  assert.equal(hits(1).multiplier, 1);
  assert.equal(hits(10).multiplier, 1.25);
  assert.equal(hits(25).multiplier, 1.5);
  assert.equal(hits(50).multiplier, 2);
  assert.equal(hits(150).multiplier, 3);
});

test('las etiquetas acompañan a los tramos', () => {
  assert.equal(hits(9).label, null);
  assert.equal(hits(25).label, 'spree');
  assert.equal(hits(150).label, 'legendary');
});

test('⭐ el combo se rompe al pasar la ventana sin teclear', () => {
  const warm = hits(30);
  assert.equal(warm.count, 30);

  // Una pulsación después de la ventana reinicia la cuenta a 1.
  const after = registerHit(warm, warm.lastHitAt + COMBO_WINDOW_MS + 1);
  assert.equal(after.count, 1);
  assert.equal(after.multiplier, 1);
  assert.equal(after.best, 30, 'el récord se conserva');
});

test('dentro de la ventana el combo continúa', () => {
  const warm = hits(30);
  const after = registerHit(warm, warm.lastHitAt + COMBO_WINDOW_MS - 1);
  assert.equal(after.count, 31);
});

test('hasExpired refleja el decay sin necesidad de otra tecla', () => {
  const warm = hits(5);
  assert.equal(hasExpired(warm, warm.lastHitAt + 100), false);
  assert.equal(hasExpired(warm, warm.lastHitAt + COMBO_WINDOW_MS + 1), true);
  assert.equal(hasExpired(initialCombo, Date.now()), false, 'sin combo no hay nada que expirar');
});

test('breakCombo conserva el récord', () => {
  const broken = breakCombo(hits(40));
  assert.equal(broken.count, 0);
  assert.equal(broken.multiplier, 1);
  assert.equal(broken.best, 40);
});

/* ── Anti-cheat (ADR-06) ─────────────────────────────────────────── */

test('⭐ un pegado grande cuenta como trampa; uno pequeño no', () => {
  assert.equal(isCheatPaste('const withTax = prices.map((p) => p * 1.21);'), true);
  assert.equal(isCheatPaste('const x = 1;'), false);
});

test('mantener una tecla pulsada no alimenta el combo', () => {
  assert.equal(isProductiveKey('a', { repeat: true }), false);
  assert.equal(isProductiveKey('a', { repeat: false }), true);
});

test('las teclas de navegación no cuentan como progreso', () => {
  for (const key of ['ArrowLeft', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape']) {
    assert.equal(isProductiveKey(key), false, `${key} no debería contar`);
  }
  for (const key of ['a', 'Z', '{', 'Enter', 'Backspace', 'Tab']) {
    assert.equal(isProductiveKey(key), true, `${key} sí debería contar`);
  }
});

/* ── XP y niveles ────────────────────────────────────────────────── */

test('la curva de niveles crece pero no se dispara', () => {
  assert.equal(xpForLevel(1), 0);
  assert.ok(xpForLevel(2) > 0);

  const costOfLevel = (level: number) => xpForLevel(level + 1) - xpForLevel(level);
  assert.ok(costOfLevel(5) > costOfLevel(2), 'cada nivel cuesta más');
  // Sin muro exponencial: el nivel 20 no puede costar 50 veces el nivel 5.
  assert.ok(costOfLevel(20) < costOfLevel(5) * 12, 'la curva no se dispara');
});

test('levelFromXp es coherente con xpForLevel', () => {
  for (const level of [1, 2, 5, 10, 20]) {
    const info = levelFromXp(xpForLevel(level));
    assert.equal(info.level, level, `XP exacto de nivel ${level}`);
    assert.equal(info.current, 0);
  }
});

test('el progreso dentro del nivel queda entre 0 y 1', () => {
  const info = levelFromXp(xpForLevel(4) + 10);
  assert.equal(info.level, 4);
  assert.ok(info.progress > 0 && info.progress < 1);
});

test('⭐ el combo multiplica la base pero NO las bonificaciones', () => {
  const common = {
    baseXp: 100,
    flawlessBonus: 50,
    noHintBonus: 25,
    comboMultiplierCap: 3,
    flawless: true,
    usedHints: false,
    hintPenalty: 0,
  };

  const sinCombo = lessonXp({ ...common, comboMultiplier: 1 });
  const conCombo = lessonXp({ ...common, comboMultiplier: 2 });

  assert.equal(sinCombo, 175, '100 + 50 + 25');
  assert.equal(conCombo, 275, '200 + 50 + 25: los bonus no se multiplican');
});

test('el multiplicador respeta el techo de la lección', () => {
  const value = lessonXp({
    baseXp: 100, flawlessBonus: 0, noHintBonus: 0,
    comboMultiplier: 3, comboMultiplierCap: 2,
    flawless: false, usedHints: true, hintPenalty: 0,
  });
  assert.equal(value, 200, 'el cap de 2 recorta el multiplicador de 3');
});

test('las pistas descuentan y el XP nunca es negativo', () => {
  const value = lessonXp({
    baseXp: 100, flawlessBonus: 0, noHintBonus: 0,
    comboMultiplier: 1, comboMultiplierCap: 3,
    flawless: false, usedHints: true, hintPenalty: 500,
  });
  assert.equal(value, 0);
});

/* ── Logros ──────────────────────────────────────────────────────── */

const catalog = AchievementCatalogSchema.parse(
  JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, '../content/achievements/achievements.json'),
      'utf8',
    ),
  ),
);

test('el catálogo de logros es válido y bilingüe', () => {
  assert.ok(catalog.length >= 10);
  const ids = catalog.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'sin ids duplicados');

  for (const achievement of catalog) {
    assert.ok(achievement.title.es && achievement.title.en, `${achievement.id} sin traducir`);
    assert.ok(achievement.description.es !== achievement.description.en, `${achievement.id}: ES y EN idénticos`);
  }
});

test('los logros del contenido existen en el catálogo', () => {
  // Los que las lecciones prometen deben poder concederse de verdad.
  const known = new Set(catalog.map((a) => a.id));
  const referenced = ['first-steps', 'docker-master', 'algorithm-slayer'];
  for (const id of referenced) assert.ok(known.has(id), `falta el logro ${id}`);
});

test('cada tipo de disparador se evalúa correctamente', () => {
  const stats: PlayerStats = {
    ...emptyStats,
    bestCombo: 60,
    totalKeystrokes: 12_000,
    completedLessons: ['a', 'b'],
    completedModules: ['javascript'],
    flawlessStreak: 3,
    noHintLessons: 2,
    interviewsByCategory: { infra: 1 },
    fastestClearSeconds: 240,
  };

  const by = (id: string) => catalog.find((a) => a.id === id)!;

  assert.equal(isUnlocked(by('syntax-ninja'), stats), true, 'combo 60 ≥ 50');
  assert.equal(isUnlocked(by('coding-spree'), stats), false, 'combo 60 < 150');
  assert.equal(isUnlocked(by('keyboard-warrior'), stats), true);
  assert.equal(isUnlocked(by('javascript-adept'), stats), true);
  assert.equal(isUnlocked(by('react-adept'), stats), false);
  assert.equal(isUnlocked(by('flawless-run'), stats), true);
  assert.equal(isUnlocked(by('no-hands-held'), stats), false, '2 < 5');
  assert.equal(isUnlocked(by('docker-master'), stats), true, 'infra: 1');
  assert.equal(isUnlocked(by('speed-runner'), stats), true, '240s < 300s');
});

test('⭐ solo se notifican los logros NUEVOS', () => {
  const stats: PlayerStats = { ...emptyStats, bestCombo: 60, completedLessons: ['a'] };

  const first = findNewlyUnlocked(catalog, stats, []);
  assert.ok(first.some((a) => a.id === 'syntax-ninja'));

  // Segunda vuelta con los mismos ya registrados: nada que celebrar.
  const again = findNewlyUnlocked(catalog, stats, first.map((a) => a.id));
  assert.deepEqual(again, [], 'reabrir la app no debe disparar toasts viejos');
});

test('el progreso hacia un logro se acota a 1', () => {
  const stats: PlayerStats = { ...emptyStats, bestCombo: 500 };
  const value = progressToward(catalog.find((a) => a.id === 'syntax-ninja')!, stats);
  assert.equal(value, 1);
});

test('los logros no acumulativos solo valen 0 o 1', () => {
  const locked = progressToward(
    catalog.find((a) => a.id === 'javascript-adept')!,
    emptyStats,
  );
  const unlocked = progressToward(catalog.find((a) => a.id === 'javascript-adept')!, {
    ...emptyStats,
    completedModules: ['javascript'],
  });
  assert.equal(locked, 0);
  assert.equal(unlocked, 1);
});

test('el catálogo se localiza sin dejar objetos {es,en} sueltos', () => {
  const spanish = localize(catalog, 'es');
  assert.equal(typeof spanish[0].title, 'string');
  assert.equal(typeof spanish[0].description, 'string');
  assert.equal(JSON.stringify(spanish).includes('"es":'), false);
});
