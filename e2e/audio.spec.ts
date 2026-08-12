import { expect, test, type Page } from '@playwright/test';

/**
 * Equilibrio y carácter de los packs de sonido.
 *
 * No puede juzgar si algo «suena a pato» —eso es de oído— pero sí verifica lo
 * medible, y lo medible es justo donde se rompió: al subir el graznido, los
 * otros cinco packs quedaron enterrados sin que nada lo detectara.
 */

type Metrics = { peak: number; rms: number };

async function measure(page: Page, pack: string, event = 'key'): Promise<Metrics> {
  return page.evaluate(
    async ([packName, eventName]) => {
      const probe = (window as unknown as {
        __audioProbe?: {
          renderPackSample: (p: string, e: string) => Promise<Float32Array>;
        };
      }).__audioProbe;
      if (!probe) throw new Error('la sonda de audio no está expuesta');

      const data = await probe.renderPackSample(packName, eventName);
      let peak = 0;
      let energy = 0;
      for (const sample of data) {
        peak = Math.max(peak, Math.abs(sample));
        energy += sample * sample;
      }
      return { peak, rms: Math.sqrt(energy / data.length) };
    },
    [pack, event] as const,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/es');
  await page.waitForFunction(
    () => Boolean((window as unknown as { __audioProbe?: unknown }).__audioProbe),
    { timeout: 20_000 },
  );
});

test('⭐ los packs suenan a un nivel parecido y ninguno satura', async ({ page }) => {
  const packs = ['mechanical', 'typewriter', 'duck', 'blades', 'retro'];
  const results: Record<string, Metrics> = {};

  for (const pack of packs) results[pack] = await measure(page, pack);

  console.log(
    '--- niveles:',
    JSON.stringify(results, (_, v) => (typeof v === 'number' ? Number(v.toFixed(4)) : v)),
  );

  for (const [pack, metrics] of Object.entries(results)) {
    expect(metrics.peak, `${pack} está al límite de saturar`).toBeLessThan(0.85);
    expect(metrics.rms, `${pack} no suena`).toBeGreaterThan(0.0008);
  }

  const levels = Object.values(results).map((r) => r.rms);
  // Más de 6× de diferencia obliga a tocar el volumen del sistema al cambiar
  // de pack, que es lo que no debe pasar.
  expect(
    Math.max(...levels) / Math.min(...levels),
    'los packs están desequilibrados',
  ).toBeLessThan(6);
});

test('el pack silencioso no produce nada', async ({ page }) => {
  const silent = await measure(page, 'silent');
  expect(silent.peak).toBe(0);
});

test('⭐ el graznido tiene formante nasal y aspereza', async ({ page }) => {
  const analysis = await page.evaluate(async () => {
    const probe = (window as unknown as {
      __audioProbe: { renderPackSample: (p: string, e: string) => Promise<Float32Array> };
    }).__audioProbe;
    const data = await probe.renderPackSample('duck', 'key');
    const RATE = 44100;

    const band = (from: number, to: number) => {
      let total = 0;
      for (let freq = from; freq <= to; freq += 30) {
        let re = 0;
        let im = 0;
        for (let i = 0; i < Math.min(data.length, RATE * 0.12); i += 2) {
          const angle = (2 * Math.PI * freq * i) / RATE;
          re += data[i] * Math.cos(angle);
          im += data[i] * Math.sin(angle);
        }
        total += Math.hypot(re, im);
      }
      return total;
    };

    const win = Math.floor(RATE * 0.004);
    const envelope: number[] = [];
    for (let i = 0; i + win < Math.floor(RATE * 0.11); i += win) {
      let localPeak = 0;
      for (let j = i; j < i + win; j++) localPeak = Math.max(localPeak, Math.abs(data[j]));
      envelope.push(localPeak);
    }
    let reversals = 0;
    for (let i = 2; i < envelope.length; i++) {
      if ((envelope[i] > envelope[i - 1]) !== (envelope[i - 1] > envelope[i - 2])) reversals++;
    }

    return { fundamental: band(200, 320), formants: band(500, 2900), reversals };
  });

  console.log('--- graznido:', JSON.stringify(analysis, (_, v) =>
    typeof v === 'number' ? Number(v.toFixed(2)) : v));

  expect(
    analysis.formants,
    'si domina la fundamental suena a «pío», no a graznido',
  ).toBeGreaterThan(analysis.fundamental * 3);
  expect(analysis.reversals, 'la aspereza exige modulación').toBeGreaterThan(3);
});
