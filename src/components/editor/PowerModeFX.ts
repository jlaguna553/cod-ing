/**
 * Partículas de "Power Mode" sobre un canvas superpuesto al editor.
 *
 * Tres decisiones que sostienen los 60 fps:
 *
 * 1. **Canvas, no DOM.** Un `<div>` por partícula obligaría al navegador a
 *    recalcular estilo y layout de decenas de nodos por fotograma. En canvas
 *    todo es una sola capa que se repinta.
 * 2. **Pool fijo, sin asignaciones.** Las partículas se reciclan de un array
 *    preasignado. Crear objetos en cada pulsación llenaría la nursery del GC
 *    y produciría microparones justo mientras alguien escribe rápido.
 * 3. **El bucle se detiene solo.** Sin partículas vivas no hay
 *    `requestAnimationFrame` pendiente: el coste en reposo es cero, no un
 *    bucle vacío girando a 60 Hz.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
  active: boolean;
}

const POOL_SIZE = 220;
const GRAVITY = 0.32;
const FRICTION = 0.97;

/** Paleta alineada con los acentos del tema. */
const HUES = [188, 275, 43, 142];

export class PowerModeFX {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private pool: Particle[] = [];
  private cursor = 0;
  private frame: number | null = null;
  private alive = 0;
  private dpr = 1;

  /** Multiplicador de intensidad; la Fase 6 lo conectará al combo. */
  intensity = 1;
  enabled = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });

    for (let index = 0; index < POOL_SIZE; index++) {
      this.pool.push({
        x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 1, hue: 188, active: false,
      });
    }
  }

  /** Ajusta el buffer al tamaño real en píxeles del dispositivo. */
  resize(width: number, height: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Emite un chorro de partículas en la posición del cursor. */
  burst(x: number, y: number) {
    if (!this.enabled) return;

    const count = Math.min(4 + Math.floor(this.intensity * 3), 14);

    for (let index = 0; index < count; index++) {
      const particle = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % POOL_SIZE;
      if (!particle.active) this.alive++;

      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const speed = 1.4 + Math.random() * 2.6 * this.intensity;

      particle.x = x;
      particle.y = y;
      particle.vx = Math.cos(angle) * speed;
      particle.vy = Math.sin(angle) * speed;
      particle.maxLife = 28 + Math.random() * 22;
      particle.life = particle.maxLife;
      particle.size = 1.2 + Math.random() * 2.2;
      particle.hue = HUES[Math.floor(Math.random() * HUES.length)];
      particle.active = true;
    }

    this.start();
  }

  private start() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = () => {
    const ctx = this.ctx;
    if (!ctx) return;

    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;
    ctx.clearRect(0, 0, width, height);

    // `lighter` hace que los solapes brillen: el aspecto neón sale de aquí,
    // no de aplicar sombras por partícula (que sí serían caras).
    ctx.globalCompositeOperation = 'lighter';

    let stillAlive = 0;

    for (const particle of this.pool) {
      if (!particle.active) continue;

      particle.vy += GRAVITY;
      particle.vx *= FRICTION;
      particle.vy *= FRICTION;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.life -= 1;

      if (particle.life <= 0 || particle.y > height + 20) {
        particle.active = false;
        continue;
      }

      const ratio = particle.life / particle.maxLife;
      ctx.fillStyle = `hsla(${particle.hue}, 95%, 62%, ${ratio * 0.85})`;
      ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
      stillAlive++;
    }

    ctx.globalCompositeOperation = 'source-over';
    this.alive = stillAlive;

    // Coste cero en reposo: si no queda nada vivo, no se pide otro fotograma.
    this.frame = stillAlive > 0 ? requestAnimationFrame(this.tick) : null;
  };

  /** Sacudida de la superficie, para el "daño". */
  shake(element: HTMLElement, magnitude = 1) {
    if (!this.enabled) return;
    element.animate(
      [
        { transform: 'translateX(0)' },
        { transform: `translateX(${-3 * magnitude}px)` },
        { transform: `translateX(${3 * magnitude}px)` },
        { transform: `translateX(${-2 * magnitude}px)` },
        { transform: 'translateX(0)' },
      ],
      { duration: 220, easing: 'ease-in-out' },
    );
  }

  dispose() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const particle of this.pool) particle.active = false;
    this.alive = 0;
  }

  get particleCount() {
    return this.alive;
  }
}
