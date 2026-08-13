/**
 * Tipos del build de navegador de `@vue/compiler-sfc`.
 *
 * El paquete solo declara tipos para su punto de entrada, y ahí el bundler
 * prefiere la condición `node` —el build CJS, que arrastra `consolidate` y
 * treinta motores de plantillas—. Se importa la ruta explícita del ESM de
 * navegador, y esta declaración le pone la forma mínima que usamos.
 */
declare module '@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js' {
  interface SFCBlock {
    content: string;
  }

  interface SFCDescriptor {
    styles: SFCBlock[];
  }

  export function parse(
    source: string,
    options?: { filename?: string },
  ): { descriptor: SFCDescriptor; errors: Array<{ message: string }> };

  export function compileScript(
    descriptor: SFCDescriptor,
    options: { id: string; inlineTemplate?: boolean },
  ): { content: string };
}
