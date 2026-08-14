/**
 * Espejo inerte del DOM ejecutado (ADR-10).
 *
 * El marco donde corre el código del usuario nunca se puede leer desde el
 * anfitrión, y por dos motivos distintos según el runner:
 *
 * - `dom` usa `sandbox="allow-scripts"` sin `allow-same-origin`, así que tiene
 *   origen opaco y `contentDocument` vale `null`.
 * - `sandpack` sirve el bundle desde **otro dominio** (`*.codesandbox.io`), y
 *   la política de mismo origen dice lo mismo.
 *
 * En los dos casos la salida es idéntica: el marco de ejecución manda su HTML
 * ya renderizado, y aquí se vuelca en un segundo iframe con `allow-same-origin`
 * y **sin** `allow-scripts` — legible, inerte, y con layout de verdad para que
 * `getComputedStyle` responda algo que signifique algo.
 *
 * Las dos concesiones del sandbox nunca coinciden en el mismo marco.
 */
export class DomMirror {
  private frame: HTMLIFrameElement | null = null;

  constructor(private readonly mount: HTMLElement) {}

  /** Documento legible, o `null` si aún no ha llegado nada que reflejar. */
  getDocument(): Document | null {
    return this.frame?.contentDocument ?? null;
  }

  /** Descarta el reflejo anterior. Se llama al empezar una ejecución nueva. */
  clear(): void {
    this.frame?.remove();
    this.frame = null;
  }

  /**
   * Vuelca el HTML recibido.
   *
   * Se oculta con `visibility`, no con `display:none`: sobre un árbol sin
   * layout, `getComputedStyle` devuelve valores por defecto —`box-sizing`
   * daría `content-box` pase lo que pase— y las reglas de CSS no podrían
   * comprobar nada.
   */
  render(html: string): Promise<void> {
    return new Promise((resolve) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('tabindex', '-1');
      frame.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;border:0;visibility:hidden;pointer-events:none';

      const previous = this.frame;
      this.frame = frame;

      let done = false;
      /**
       * Montado significa **con el documento dentro**, no «ha llegado un load».
       *
       * Insertar un iframe dispara un primer `load` por su `about:blank`
       * inicial, antes de que el `srcdoc` se haya cargado. Aceptándolo, la
       * promesa se resolvía con un documento vacío y el espejo anterior ya
       * retirado: el evaluador leía **cero elementos** sobre un código
       * correcto. Se veía como un fallo intermitente e imposible —la copia en
       * pantalla tenía el contenido a la vista— porque quien miraba el DOM a
       * mano siempre llegaba tarde a la carrera.
       */
      const cargado = () => (frame.contentDocument?.URL ?? 'about:blank') !== 'about:blank';

      const finish = (forzado = false) => {
        if (done || (!forzado && !cargado())) return;
        done = true;
        previous?.remove();
        resolve();
      };

      frame.addEventListener('load', () => finish());
      // Sin red de seguridad, un `load` que no llegue dejaría colgada la
      // promesa de la ejecución entera.
      window.setTimeout(() => finish(true), 1500);

      // El `srcdoc` va antes de insertarlo: así el navegador tiene qué cargar
      // desde el principio en vez de pasar por `about:blank`.
      frame.srcdoc = html;
      this.mount.appendChild(frame);
    });
  }

  dispose(): void {
    this.clear();
  }
}

/**
 * Código que se inyecta en el marco de ejecución para que mande su DOM.
 *
 * Va como texto porque acaba dentro del bundle del usuario. El
 * `MutationObserver` es lo que hace que funcione con un framework: cuando el
 * bundler termina, la aplicación **aún no ha montado**, así que un único envío
 * llegaría con el `<div id="app">` vacío. Cada repintado manda una versión
 * nueva y el anfitrión se queda con la última.
 *
 * Se manda a `window.top` y no a `parent` porque Sandpack **anida**: nuestro
 * iframe carga la página del bundler, y esa página crea otro iframe donde de
 * verdad se evalúa el código. Desde ahí `parent` es el bundler, y el espejo
 * recibía su documento —con browserfs y babel dentro— en lugar de la
 * aplicación montada.
 *
 * Ojo al editar: esto es un template literal. Un backtick aquí dentro cierra
 * la cadena y rompe el módulo entero.
 */
export const MIRROR_PROBE = `
;(function () {
  if (window.__codequestProbe) return;
  window.__codequestProbe = true;

  // Se manda a window.top, no a parent: ver la nota de MIRROR_PROBE.
  var send = function () {
    try {
      (window.top || parent).postMessage(
        { __codequestDom: document.documentElement.outerHTML },
        '*',
      );
    } catch (error) {
      /* el anfitrión puede haberse ido; no es asunto del sandbox */
    }
  };

  var schedule = function () {
    if (schedule.pending) return;
    schedule.pending = true;
    setTimeout(function () {
      schedule.pending = false;
      send();
    }, 50);
  };

  new MutationObserver(schedule).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  send();
  setTimeout(send, 300);
})();
`;
