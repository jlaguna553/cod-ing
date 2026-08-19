import type { VirtualFs } from './vfs';

/**
 * `next build` y `next dev`, simulados sobre el sistema de archivos (ADR-27).
 *
 * ## Por qué simular esto y no ejecutarlo
 *
 * Next necesita Node —y WebContainers, que es la única forma de tenerlo en el
 * navegador, sigue bloqueado por licencia (ADR-07)—. Pero es que además, para
 * lo que esta parte enseña, **ejecutarlo no aportaría casi nada**: el App
 * Router se aprende leyendo el árbol de archivos, porque el árbol de archivos
 * *es* el router. Qué rutas existen, cuál es estática y cuál dinámica, y qué
 * componente corre en el servidor: todo eso está en los nombres y en las
 * primeras líneas de cada archivo.
 *
 * Lo que sí se reproduce con cuidado son **los errores**. Los tres de esta
 * lista son los que se lleva por delante a todo el que empieza, y el valor de
 * la lección está en verlos con su texto y saber qué los provoca:
 *
 * 1. Un hook o un manejador de eventos en un componente de servidor.
 * 2. `export const metadata` en un componente de cliente.
 * 3. Un `app/` sin layout raíz.
 *
 * ## Lo que NO hace
 *
 * No compila, no ejecuta React, no resuelve imports y no sabe si tu JSX es
 * válido. Un `next build` verde aquí significa «las convenciones están bien»,
 * no «esto funciona». Se dice en la lección con estas palabras.
 */

export interface Ruta {
  /** Ruta URL: `/`, `/blog/[slug]`. */
  url: string;
  /** Archivo que la declara. */
  archivo: string;
  /** `estatica` se prerenderiza; `dinamica` se renderiza por petición. */
  tipo: 'estatica' | 'dinamica';
}

export interface ResultadoNext {
  ok: boolean;
  salida: string[];
  rutas: Ruta[];
  errores: string[];
}

/** Hooks y props que solo existen en el navegador. */
const SOLO_CLIENTE = [
  'useState',
  'useEffect',
  'useReducer',
  'useContext',
  'useRef',
  'onClick',
  'onChange',
  'onSubmit',
];

const ES_CLIENTE = /^\s*(['"])use client\1/;

/**
 * Convierte la ruta de un archivo en la URL que sirve.
 *
 * Las carpetas entre paréntesis —`(marketing)`— son **grupos de rutas**: sirven
 * para organizar y para compartir layout, y no aparecen en la URL. Es de las
 * primeras cosas que sorprenden del App Router, así que se reproduce.
 */
export function urlDeArchivo(archivo: string): string {
  const segmentos = archivo
    .replace(/^app\//, '')
    // El `/` inicial es opcional: en la raíz, tras quitar `app/`, lo que queda
    // es `page.tsx` a secas y la ruta es `/`.
    .replace(/(^|\/)page\.(tsx|jsx|ts|js)$/, '')
    .split('/')
    .filter((parte) => parte !== '' && !/^\(.+\)$/.test(parte));

  return segmentos.length === 0 ? '/' : `/${segmentos.join('/')}`;
}

/** Un archivo de página, ¿es de cliente? */
function esCliente(contenido: string): boolean {
  return ES_CLIENTE.test(contenido);
}

export function nextBuild(fs: VirtualFs, modo: 'build' | 'dev' = 'build'): ResultadoNext {
  const archivos = fs.paths();
  const paginas = archivos
    .filter((ruta) => /^app\/.*page\.(tsx|jsx|ts|js)$/.test(ruta) || /^app\/page\.(tsx|jsx|ts|js)$/.test(ruta))
    .sort();

  const salida: string[] = [];
  const errores: string[] = [];

  salida.push(modo === 'dev' ? '▲ Next.js — dev' : '▲ Next.js — build');

  /*
   * El layout raíz no es opcional.
   *
   * Es el único que declara `<html>` y `<body>`, así que sin él no hay
   * documento donde meter nada. Next lo dice con estas palabras y es de los
   * pocos errores suyos que explican también la solución.
   */
  const tieneLayoutRaiz = archivos.some((ruta) => /^app\/layout\.(tsx|jsx|ts|js)$/.test(ruta));
  if (paginas.length > 0 && !tieneLayoutRaiz) {
    errores.push(
      "Error: page.tsx doesn't have a root layout. To fix this error, make sure every page has a root layout at app/layout.tsx.",
    );
  }

  const rutas: Ruta[] = [];

  for (const archivo of paginas) {
    const contenido = fs.read(archivo) ?? '';
    const cliente = esCliente(contenido);

    // Un hook del navegador en un componente de servidor.
    if (!cliente) {
      const encontrado = SOLO_CLIENTE.find((api) => contenido.includes(api));
      if (encontrado) {
        errores.push(
          `Error: ${archivo}\n` +
            `You're importing a component that needs \`${encontrado}\`. This React hook only works in a Client Component. ` +
            `To fix, mark the file (or its parent) with the "use client" directive.`,
        );
      }
    }

    // `metadata` es cosa del servidor: en cliente, Next lo rechaza.
    if (cliente && /export\s+const\s+metadata/.test(contenido)) {
      errores.push(
        `Error: ${archivo}\n` +
          'You are attempting to export "metadata" from a component marked with "use client", which is disallowed. ' +
          'Either remove the export, or the "use client" directive.',
      );
    }

    const url = urlDeArchivo(archivo);

    /*
     * Estática o dinámica.
     *
     * Una ruta con parámetro es dinámica salvo que la lección publique
     * `generateStaticParams`, que es exactamente lo que hace Next: con esa
     * función sabe de antemano qué páginas existen y las prerenderiza.
     */
    const tieneParametro = /\[.+\]/.test(archivo);
    const prerenderiza = /generateStaticParams/.test(contenido);
    rutas.push({
      url,
      archivo,
      tipo: tieneParametro && !prerenderiza ? 'dinamica' : 'estatica',
    });
  }

  if (paginas.length === 0) {
    errores.push(
      'Error: Couldn\'t find any `page` file inside `app/`. Every route needs a page.tsx that default-exports a component.',
    );
  }

  if (errores.length > 0) {
    return { ok: false, salida: [...salida, ...errores], rutas: [], errores };
  }

  salida.push('');
  salida.push('Route (app)');
  for (const ruta of rutas.sort((a, b) => a.url.localeCompare(b.url))) {
    // Los mismos símbolos que imprime Next: ○ prerenderizada, ƒ por petición.
    salida.push(`${ruta.tipo === 'estatica' ? '○' : 'ƒ'} ${ruta.url}`);
  }
  salida.push('');
  salida.push('○  (Static)   prerendered as static content');
  salida.push('ƒ  (Dynamic)  server-rendered on demand');

  if (modo === 'dev') salida.push('', '- Local: http://localhost:3000');
  else salida.push('', `✓ Compiled successfully — ${rutas.length} ruta(s)`);

  return { ok: true, salida, rutas, errores: [] };
}
