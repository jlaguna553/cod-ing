import type { Monaco } from '@monaco-editor/react';

/**
 * El compilador de TypeScript que ya está cargado.
 *
 * Monaco trae el suyo para dibujar los subrayados rojos del editor, y expone
 * su servicio de lenguaje: diagnósticos y emisión de JavaScript. Son los
 * mismos ocho megas que ya se descargan para poder escribir; pedir otro
 * compilador aparte sería descargarlos dos veces para dar la misma respuesta.
 *
 * Y hay una razón mejor que el peso: **el error que juzga la lección es
 * exactamente el que el usuario ve subrayado**. Con dos compiladores distintos
 * cabría la posibilidad de que el editor no dijera nada y la comprobación
 * fallara, que es la peor forma de suspender a alguien.
 *
 * El puente existe porque el runner vive fuera de React y Monaco entra por un
 * componente. Es una variable de módulo y no un contexto a propósito: los
 * runners no son componentes y no deben empezar a serlo para leer esto.
 */

let instancia: Monaco | null = null;
const esperando: Array<(monaco: Monaco) => void> = [];

/** Lo llama el editor al montar. */
export function setMonaco(monaco: Monaco): void {
  instancia = monaco;
  while (esperando.length > 0) esperando.shift()?.(monaco);
}

/**
 * Espera a que el editor esté montado.
 *
 * El runner arranca a la vez que el editor y puede ganarle la carrera; sin
 * esta espera, la primera ejecución de una lección de TypeScript fallaría con
 * «no hay compilador» solo por haber pulsado rápido.
 */
export function getMonaco(timeoutMs = 20_000): Promise<Monaco> {
  if (instancia) return Promise.resolve(instancia);

  return new Promise((resolve, reject) => {
    const temporizador = setTimeout(
      () => reject(new Error('El editor no llegó a montarse: no hay compilador de TypeScript.')),
      timeoutMs,
    );

    esperando.push((monaco) => {
      clearTimeout(temporizador);
      resolve(monaco);
    });
  });
}
