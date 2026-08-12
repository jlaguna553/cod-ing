import { PACKS, type SoundEvent, type SoundPack, type VoiceContext } from './packs';

/**
 * Motor de audio.
 *
 * Tres cosas que hay que hacer bien o el sonido estorba en vez de aportar:
 *
 * 1. **El `AudioContext` arranca suspendido.** Los navegadores bloquean el
 *    audio hasta que hay un gesto real del usuario. Si no se reanuda entonces,
 *    el pack «no suena» y parece roto. `unlock()` se llama en el primer clic o
 *    pulsación.
 * 2. **Techo de voces simultáneas.** Escribir muy rápido no puede convertirse
 *    en un muro de ruido ni disparar decenas de nodos por segundo. Por encima
 *    del límite, la voz simplemente se descarta.
 * 3. **Un único nodo de ganancia maestro.** El volumen y el silencio total se
 *    controlan en un solo punto, no pack por pack.
 */

const MAX_VOICES = 12;
/** Ventana para contar voces activas, en ms. */
const VOICE_WINDOW = 90;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private recentVoices: number[] = [];

  private pack: SoundPack = 'silent';
  // 0.8 y no 0.6: con el valor anterior los packs se oían flojos incluso al
  // máximo del sistema. El usuario sigue teniendo el deslizador para bajarlo.
  private volume = 0.8;
  private muted = false;

  /** 0..1 — la Fase 6 la alimenta con el combo. */
  intensity = 0;

  get isReady(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get currentPack(): SoundPack {
    return this.pack;
  }

  setPack(pack: SoundPack) {
    this.pack = pack;
  }

  setVolume(volume: number) {
    this.volume = Math.min(Math.max(volume, 0), 1);
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : this.volume;
  }

  /**
   * Crea o reanuda el contexto. Debe llamarse desde un gesto del usuario.
   * Es idempotente: llamarlo en cada clic no cuesta nada.
   */
  async unlock(): Promise<void> {
    if (this.pack === 'silent') return;

    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;

      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.noise = createNoiseBuffer(this.ctx);
    }

    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** Dispara un evento. Silencioso y barato si el motor no está listo. */
  play(event: SoundEvent) {
    if (this.pack === 'silent' || this.muted) return;
    if (!this.ctx || !this.master || !this.noise) return;
    if (this.ctx.state !== 'running') return;

    const now = performance.now();
    this.recentVoices = this.recentVoices.filter((at) => now - at < VOICE_WINDOW);
    if (this.recentVoices.length >= MAX_VOICES) return;
    this.recentVoices.push(now);

    const context: VoiceContext = {
      ctx: this.ctx,
      destination: this.master,
      noise: this.noise,
      intensity: this.intensity,
      pack: this.pack,
    };

    try {
      PACKS[this.pack](event, context);
    } catch {
      // Un fallo de audio nunca debe interrumpir al usuario escribiendo.
    }
  }

  /** Traduce una tecla al evento sonoro que le corresponde. */
  playKey(key: string) {
    if (key === 'Enter') return this.play('enter');
    if (key === 'Backspace' || key === 'Delete') return this.play('backspace');
    if (key === ' ' || key === 'Spacebar') return this.play('space');
    this.play('key');
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.recentVoices = [];
  }
}

/**
 * Renderiza un evento sin reproducirlo, para poder MEDIRLO.
 *
 * Existe porque el equilibrio entre packs no se puede juzgar de oído de forma
 * fiable: un pack puede sonar «bien» en unos altavoces y desaparecer en otros.
 * Con esto, `e2e/audio.spec.ts` compara el RMS de los seis y falla si alguno
 * se desvía — que es justo lo que ocurrió al subir el graznido y dejar a los
 * demás enterrados.
 */
export async function renderPackSample(
  pack: SoundPack,
  event: SoundEvent,
  seconds = 0.6,
): Promise<Float32Array> {
  const rate = 44100;
  const ctx = new OfflineAudioContext(1, Math.ceil(rate * seconds), rate);

  const noise = ctx.createBuffer(1, rate, rate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < rate; i++) data[i] = Math.random() * 2 - 1;

  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  PACKS[pack](event, { ctx, destination: master, noise, intensity: 0, pack });

  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

/** Un segundo de ruido blanco, reutilizado por todas las voces. */
function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index++) data[index] = Math.random() * 2 - 1;
  return buffer;
}

/** Instancia única: crear un `AudioContext` por componente agotaría el límite. */
let engine: SoundEngine | null = null;

export function getSoundEngine(): SoundEngine {
  engine ??= new SoundEngine();
  return engine;
}
