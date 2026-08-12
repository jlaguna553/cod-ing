/**
 * Packs de sonido **sintetizados**, no grabados.
 *
 * Por qué no usar muestras de audio:
 *
 * - **Cero bytes de descarga.** El presupuesto que el roadmap fijaba en 150 KB
 *   por pack pasa a ser 0. Nada que precargar, nada que fallar en una conexión
 *   mala, ningún pack "que no suena" porque el CDN tardó.
 * - **Variación real y gratis.** Cada pulsación puede cambiar frecuencia,
 *   duración y timbre. Con muestras haría falta grabar 3-4 por tecla y aun así
 *   se oye el bucle; aquí no hay dos golpes idénticos.
 * - **Sin licencias.** Ningún banco de sonidos que auditar antes de lanzar.
 *
 * El coste: un "teclado mecánico" sintetizado no engaña a un audiófilo. Para
 * el propósito —que teclear tenga peso y sea divertido— llega de sobra, y
 * `duck` o `retro` suenan incluso mejor sintetizados.
 */

export const SOUND_PACKS = [
  'silent',
  'mechanical',
  'typewriter',
  'duck',
  'blades',
  'retro',
] as const;

export type SoundPack = (typeof SOUND_PACKS)[number];

export type SoundEvent =
  | 'key'
  | 'enter'
  | 'backspace'
  | 'space'
  | 'combo'
  | 'levelUp'
  | 'achievement'
  | 'damage';

export interface VoiceContext {
  ctx: BaseAudioContext;
  destination: AudioNode;
  /** Ruido blanco compartido: generarlo por voz sería tirar CPU. */
  noise: AudioBuffer;
  /** 0..1, sube con el combo. Modula tono y brillo. */
  intensity: number;
  /** Pack activo, para aplicar su compensación de ganancia. */
  pack: SoundPack;
}

/** Un pack es una función que dispara una voz para un evento. */
export type PackVoice = (event: SoundEvent, context: VoiceContext) => void;

/**
 * Compensación por pack.
 *
 * Cada receta pierde energía de forma distinta: los filtros resonantes del
 * pato y de las espadas descartan casi todo el espectro, mientras que un tono
 * limpio no pierde nada. Sin esta tabla, subir el volumen de uno deja a los
 * demás inaudibles — que es exactamente lo que pasó al arreglar el graznido.
 *
 * Los valores salen de medir el RMS de cada pack y normalizarlos
 * (`tests`/`e2e/audio.spec.ts` lo verifica y falla si vuelven a divergir).
 */
const PACK_GAIN: Record<SoundPack, number> = {
  silent: 0,
  // Calibrados para un `peak` de ~0.5: el ruido de cada voz es aleatorio y
  // apurar hasta 0.9 hacía que alguna pulsación saturara de vez en cuando.
  mechanical: 4.7,
  typewriter: 6.6,
  duck: 0.7,   // ya lleva su propia compensación de formantes (MAKEUP)
  blades: 22,  // impulsivo: mismo RMS que el resto pero con picos más altos
  retro: 7.6,
};

/** Ganancia efectiva de una voz, ya compensada por pack. */
function level(context: VoiceContext, base: number): number {
  return base * (PACK_GAIN[context.pack] ?? 1);
}

/* ── utilidades de síntesis ──────────────────────────────────────── */

function envelope(
  ctx: BaseAudioContext,
  attack: number,
  decay: number,
  peak = 1,
): GainNode {
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  return gain;
}

function playNoise(context: VoiceContext, options: {
  duration: number;
  frequency: number;
  q: number;
  gain: number;
  type?: BiquadFilterType;
}) {
  const { ctx, destination, noise } = context;
  const source = ctx.createBufferSource();
  source.buffer = noise;

  const filter = ctx.createBiquadFilter();
  filter.type = options.type ?? 'bandpass';
  filter.frequency.value = options.frequency;
  filter.Q.value = options.q;

  const gain = envelope(ctx, 0.001, options.duration, level(context, options.gain));

  source.connect(filter).connect(gain).connect(destination);
  source.start();
  source.stop(ctx.currentTime + options.duration + 0.02);
}

function playTone(context: VoiceContext, options: {
  type: OscillatorType;
  from: number;
  to?: number;
  duration: number;
  gain: number;
  attack?: number;
}) {
  const { ctx, destination } = context;
  const osc = ctx.createOscillator();
  osc.type = options.type;

  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(options.from, now);
  if (options.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(options.to, 1), now + options.duration);
  }

  const gain = envelope(ctx, options.attack ?? 0.002, options.duration, level(context, options.gain));
  osc.connect(gain).connect(destination);
  osc.start();
  osc.stop(now + options.duration + 0.02);
}

/**
 * Graznido.
 *
 * Un cuack es, acústicamente, una **vocal nasal áspera** — algo como «kwæk».
 * Y las vocales no se hacen con un filtro: se hacen con varios **formantes en
 * paralelo**. Encadenarlos en serie solo atenúa; sumarlos en paralelo es lo
 * que crea el timbre vocal.
 *
 * Las cinco piezas, y por qué cada una:
 *
 * 1. `sawtooth` grave (~250 Hz) con vibrato: la fuente armónica, la «glotis».
 * 2. **Tres formantes en paralelo** (F1≈780, F2≈1900, F3≈2900 Hz). F1 y F2
 *    barren hacia abajo: ese movimiento es el «cua→ack».
 * 3. Un soplo de ruido de 12 ms al principio: el aire del pico al abrirse.
 *    Sin él, el ataque suena sintético.
 * 4. Saturación suave: un graznido es un sonido *sucio*, y la distorsión añade
 *    los armónicos impares que lo hacen áspero.
 * 5. AM a ~58 Hz: la vibración del graznido.
 *
 * `MAKEUP` compensa la energía que se llevan los filtros. Medido: sin él, el
 * pato salía diez veces más flojo que el resto de packs.
 */
const MAKEUP = 26;

/** Curva de saturación suave (tanh). Añade armónicos sin romper el sonido. */
let shaperCurve: Float32Array<ArrayBuffer> | null = null;
function saturationCurve(): Float32Array<ArrayBuffer> {
  if (shaperCurve) return shaperCurve;
  const size = 1024;
  const curve = new Float32Array(new ArrayBuffer(size * 4));
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.2);
  }
  shaperCurve = curve;
  return curve;
}

function playQuack(
  context: VoiceContext,
  options: { fundamental: number; duration: number; gain: number },
) {
  const { ctx, destination, noise } = context;
  const now = ctx.currentTime;
  const end = now + options.duration;

  /* Fuente: diente de sierra con vibrato. */
  const source = ctx.createOscillator();
  source.type = 'sawtooth';
  source.frequency.setValueAtTime(options.fundamental, now);
  source.frequency.exponentialRampToValueAtTime(options.fundamental * 0.74, end);

  const vibrato = ctx.createOscillator();
  vibrato.type = 'sine';
  vibrato.frequency.value = 24;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = options.fundamental * 0.06;
  vibrato.connect(vibratoDepth).connect(source.frequency);

  /* Mezclador de formantes. */
  const mix = ctx.createGain();
  mix.gain.value = 1;

  const formant = (from: number, to: number, q: number, level: number) => {
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, now);
    filter.frequency.exponentialRampToValueAtTime(to, end);

    const level_ = ctx.createGain();
    level_.gain.value = level;

    source.connect(filter).connect(level_).connect(mix);
  };

  // F1 y F2 barren: el movimiento del formante es el "cua→ack".
  formant(780, 520, 9, 1);
  formant(1900, 1150, 7, 0.75);
  formant(2900, 2600, 5, 0.35);

  /* Soplo de aire del ataque. */
  const air = ctx.createBufferSource();
  air.buffer = noise;
  const airFilter = ctx.createBiquadFilter();
  airFilter.type = 'bandpass';
  airFilter.frequency.value = 2400;
  airFilter.Q.value = 1.2;
  const airEnv = ctx.createGain();
  airEnv.gain.setValueAtTime(0.5, now);
  airEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
  air.connect(airFilter).connect(airEnv).connect(mix);

  /* Suciedad. */
  const saturation = ctx.createWaveShaper();
  saturation.curve = saturationCurve();
  saturation.oversample = '2x';

  /* Aspereza del graznido. */
  const tremolo = ctx.createGain();
  tremolo.gain.value = 0.68;
  const buzz = ctx.createOscillator();
  buzz.type = 'sine';
  buzz.frequency.value = 58;
  const buzzDepth = ctx.createGain();
  buzzDepth.gain.value = 0.32;
  buzz.connect(buzzDepth).connect(tremolo.gain);

  /* Envolvente. */
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(level(context, options.gain) * MAKEUP, now + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);

  mix.connect(saturation).connect(tremolo).connect(envelope).connect(destination);

  source.start(now); source.stop(end + 0.02);
  vibrato.start(now); vibrato.stop(end + 0.02);
  buzz.start(now); buzz.stop(end + 0.02);
  air.start(now); air.stop(now + 0.05);
}

/** ±6 % de variación: sin esto, la repetición exacta suena a máquina rota. */
function vary(value: number, amount = 0.06): number {
  return value * (1 + (Math.random() - 0.5) * 2 * amount);
}

/* ── packs ───────────────────────────────────────────────────────── */

const mechanical: PackVoice = (event, context) => {
  const brightness = 1 + context.intensity * 0.25;

  switch (event) {
    case 'key':
      // Dos capas: el "click" del switch y el "thock" de la placa.
      playNoise(context, { duration: 0.035, frequency: vary(2400) * brightness, q: 1.2, gain: 0.16 });
      playTone(context, { type: 'triangle', from: vary(180), to: 90, duration: 0.05, gain: 0.1 });
      break;
    case 'space':
      playNoise(context, { duration: 0.05, frequency: vary(1200), q: 0.9, gain: 0.2 });
      playTone(context, { type: 'sine', from: vary(120), to: 70, duration: 0.07, gain: 0.14 });
      break;
    case 'enter':
      playNoise(context, { duration: 0.06, frequency: vary(1800), q: 1, gain: 0.22 });
      playTone(context, { type: 'triangle', from: vary(150), to: 80, duration: 0.09, gain: 0.16 });
      break;
    case 'backspace':
      playNoise(context, { duration: 0.03, frequency: vary(3200), q: 2, gain: 0.12 });
      break;
    default:
      genericFeedback(event, context);
  }
};

const typewriter: PackVoice = (event, context) => {
  switch (event) {
    case 'key':
      playNoise(context, { duration: 0.028, frequency: vary(3600), q: 3, gain: 0.15 });
      playTone(context, { type: 'square', from: vary(320), to: 140, duration: 0.03, gain: 0.06 });
      break;
    case 'space':
      playNoise(context, { duration: 0.04, frequency: vary(2200), q: 2, gain: 0.16 });
      break;
    case 'enter':
      // Campana de retorno de carro: la firma del pack.
      playTone(context, { type: 'sine', from: vary(1760), duration: 0.5, gain: 0.14, attack: 0.001 });
      playTone(context, { type: 'sine', from: vary(2640), duration: 0.35, gain: 0.07 });
      playNoise(context, { duration: 0.12, frequency: 900, q: 0.6, gain: 0.1 });
      break;
    case 'backspace':
      playNoise(context, { duration: 0.05, frequency: vary(1400), q: 1.5, gain: 0.12 });
      break;
    default:
      genericFeedback(event, context);
  }
};

const duck: PackVoice = (event, context) => {
  // Fundamental en el rango de un ánade real (~250-330 Hz). Sube algo con el
  // combo: el pato se emociona.
  const base = 265 + context.intensity * 55;

  switch (event) {
    case 'key':
      playQuack(context, { fundamental: vary(base, 0.09), duration: 0.11, gain: 0.1 });
      break;
    case 'space':
      // Más grave y largo: el graznido de descanso.
      playQuack(context, { fundamental: vary(base * 0.82, 0.07), duration: 0.16, gain: 0.12 });
      break;
    case 'enter':
      // Doble cuack: "cua-cuack". Es lo que hace que Enter se reconozca.
      playQuack(context, { fundamental: vary(base * 1.1, 0.06), duration: 0.1, gain: 0.11 });
      window.setTimeout(
        () => playQuack(context, { fundamental: vary(base * 0.9, 0.06), duration: 0.19, gain: 0.13 }),
        105,
      );
      break;
    case 'backspace':
      // Corto y hacia arriba: suena a protesta.
      playQuack(context, { fundamental: vary(base * 1.25, 0.08), duration: 0.07, gain: 0.08 });
      break;
    default:
      genericFeedback(event, context);
  }
};

const blades: PackVoice = (event, context) => {
  const edge = 1 + context.intensity * 0.4;

  switch (event) {
    case 'key':
      // Metal: ruido muy resonante y agudo, con cola corta.
      playNoise(context, { duration: 0.07, frequency: vary(5200) * edge, q: 12, gain: 0.09 });
      break;
    case 'space':
      playNoise(context, { duration: 0.1, frequency: vary(3800), q: 9, gain: 0.11 });
      break;
    case 'enter':
      playNoise(context, { duration: 0.22, frequency: vary(4600), q: 16, gain: 0.14 });
      playTone(context, { type: 'sine', from: vary(2100), to: 900, duration: 0.25, gain: 0.06 });
      break;
    case 'backspace':
      playNoise(context, { duration: 0.05, frequency: vary(6800), q: 14, gain: 0.07 });
      break;
    default:
      genericFeedback(event, context);
  }
};

const retro: PackVoice = (event, context) => {
  const step = 1 + Math.floor(context.intensity * 4);

  switch (event) {
    case 'key':
      playTone(context, { type: 'square', from: vary(440 * step, 0.03), duration: 0.035, gain: 0.05 });
      break;
    case 'space':
      playTone(context, { type: 'square', from: vary(220 * step, 0.03), duration: 0.05, gain: 0.06 });
      break;
    case 'enter':
      playTone(context, { type: 'square', from: 523, duration: 0.06, gain: 0.06 });
      playTone(context, { type: 'square', from: 784, duration: 0.09, gain: 0.05 });
      break;
    case 'backspace':
      playTone(context, { type: 'square', from: vary(160), to: 80, duration: 0.05, gain: 0.05 });
      break;
    default:
      genericFeedback(event, context);
  }
};

/** Eventos de juego: comunes a todos los packs con sonido. */
function genericFeedback(event: SoundEvent, context: VoiceContext) {
  switch (event) {
    case 'combo':
      // Sube de tono con la intensidad: el combo se OYE subir.
      playTone(context, {
        type: 'triangle',
        from: 660 + context.intensity * 440,
        to: 990 + context.intensity * 660,
        duration: 0.14,
        gain: 0.09,
      });
      break;
    case 'levelUp':
      [523, 659, 784, 1047].forEach((frequency, index) => {
        window.setTimeout(
          () => playTone(context, { type: 'triangle', from: frequency, duration: 0.22, gain: 0.11 }),
          index * 90,
        );
      });
      break;
    case 'achievement':
      [784, 1047, 1319].forEach((frequency, index) => {
        window.setTimeout(
          () => playTone(context, { type: 'sine', from: frequency, duration: 0.3, gain: 0.12 }),
          index * 70,
        );
      });
      break;
    case 'damage':
      playTone(context, { type: 'sawtooth', from: 220, to: 70, duration: 0.22, gain: 0.12 });
      playNoise(context, { duration: 0.12, frequency: 300, q: 0.8, gain: 0.1, type: 'lowpass' });
      break;
    default:
      break;
  }
}

const silent: PackVoice = () => {};

export const PACKS: Record<SoundPack, PackVoice> = {
  silent,
  mechanical,
  typewriter,
  duck,
  blades,
  retro,
};
