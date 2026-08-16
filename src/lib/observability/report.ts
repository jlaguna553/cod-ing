/**
 * Envío de telemetría desde el navegador.
 *
 * Tres cosas que la hacen inofensiva para quien está jugando:
 *
 * 1. **Se agrupa.** Los eventos se acumulan y salen juntos, no uno por
 *    petición. Escribir código genera eventos a ráfagas y una petición por
 *    cada uno competiría con el autoguardado y con el runner.
 *
 * 2. **Se manda con `sendBeacon`.** Es lo único que sobrevive a cerrar la
 *    pestaña: un `fetch` normal se cancela al descargar la página, que es
 *    justo cuando más interesa saber qué pasó. Si no está disponible, se cae a
 *    `fetch` con `keepalive`.
 *
 * 3. **Nunca lanza.** Un fallo de telemetría no puede romper una lección. Todo
 *    lo de aquí está envuelto: si algo va mal, se pierde el dato y ya.
 *
 * Lo que **no** se manda: el código del usuario. Ni entero, ni recortado, ni
 * «solo la línea del error». De un paso interesa qué reglas fallaron, y eso
 * son identificadores.
 */

import type { Evento } from './events';

const RUTA = '/api/telemetry';
/** Se vacía la cola a los dos segundos del primer evento. */
const ESPERA_MS = 2000;
/** Tope del lote, igual que el del servidor: más se descartaría entero. */
const MAX_LOTE = 20;

let cola: Evento[] = [];
let temporizador: ReturnType<typeof setTimeout> | null = null;
let instalado = false;

/** Encola un evento. Devuelve sin hacer nada en el servidor. */
export function report(evento: Evento): void {
  if (typeof window === 'undefined') return;

  try {
    instalarDescarga();

    cola.push(evento);
    if (cola.length >= MAX_LOTE) {
      flush();
      return;
    }

    temporizador ??= setTimeout(flush, ESPERA_MS);
  } catch {
    // Ni un error de telemetría puede escaparse hacia arriba.
  }
}

/** Manda lo acumulado ahora mismo. */
export function flush(): void {
  if (typeof window === 'undefined' || cola.length === 0) return;

  const lote = cola;
  cola = [];
  if (temporizador) {
    clearTimeout(temporizador);
    temporizador = null;
  }

  const cuerpo = JSON.stringify({ events: lote });

  try {
    if (navigator.sendBeacon) {
      // El tipo importa: sin él, algunos navegadores lo mandan como
      // `text/plain` y la ruta lo rechazaría por no ser JSON.
      const ok = navigator.sendBeacon(RUTA, new Blob([cuerpo], { type: 'application/json' }));
      if (ok) return;
    }

    void fetch(RUTA, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: cuerpo,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Se pierde el lote. Es telemetría.
  }
}

/**
 * Vacía la cola cuando la página se va.
 *
 * `pagehide` y `visibilitychange`, no `beforeunload`: en móvil una pestaña se
 * puede descartar sin pasar nunca por `beforeunload`, y ahí se perdería justo
 * la sesión de alguien que se fue porque algo no funcionaba.
 */
function instalarDescarga() {
  if (instalado) return;
  instalado = true;

  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

/** Solo para tests. */
export function _pendientes(): Evento[] {
  return cola;
}
