/**
 * Los comentarios del código de una lección, por extensión de archivo.
 *
 * El código de un ejercicio **también es contenido bilingüe**. Se pasó por
 * alto durante ocho fases: los enunciados, las pistas y los mensajes de las
 * reglas estaban en los dos idiomas desde el ADR-01, pero el archivo que el
 * alumno tiene delante —donde suele estar la instrucción concreta, el
 * «// Paso 1: …»— viajaba en castellano para todo el mundo.
 *
 * Esto es lo que hace falta para cerrarlo y para que no se vuelva a abrir:
 * saber qué trozos de un archivo son prosa y cuáles son código. Lo usa la
 * migración y lo usa `validate-content.ts`, que rechaza un archivo con
 * comentarios y un solo idioma.
 *
 * No es un lexer: no entiende cadenas ni plantillas, así que un `//` dentro de
 * un literal cuenta como comentario. Para lo que se usa —avisar de que un
 * archivo necesita traducción— equivocarse de más es barato y equivocarse de
 * menos es justo el fallo que se quiere evitar.
 */

/** Estilos de comentario que reconoce cada extensión. */
type Estilo = 'barras' | 'bloque' | 'almohadilla' | 'guiones' | 'html';

const POR_EXTENSION: Record<string, Estilo[]> = {
  js: ['barras', 'bloque'],
  jsx: ['barras', 'bloque'],
  mjs: ['barras', 'bloque'],
  cjs: ['barras', 'bloque'],
  ts: ['barras', 'bloque'],
  tsx: ['barras', 'bloque'],
  cs: ['barras', 'bloque'],
  java: ['barras', 'bloque'],
  go: ['barras', 'bloque'],
  php: ['barras', 'bloque'],
  css: ['bloque'],
  scss: ['bloque'],
  vue: ['barras', 'bloque', 'html'],
  html: ['html'],
  svg: ['html'],
  md: ['html'],
  sql: ['guiones', 'bloque'],
  py: ['almohadilla'],
  sh: ['almohadilla'],
  yml: ['almohadilla'],
  yaml: ['almohadilla'],
  env: ['almohadilla'],
  dockerfile: ['almohadilla'],
  dockerignore: ['almohadilla'],
  gitignore: ['almohadilla'],
};

function estilosDe(ruta: string): Estilo[] {
  const nombre = ruta.split('/').pop() ?? ruta;

  // `Dockerfile` y `.dockerignore` no tienen extensión en el sentido normal.
  const sinExtension = nombre.toLowerCase().replace(/^\./, '');
  if (POR_EXTENSION[sinExtension]) return POR_EXTENSION[sinExtension];

  const extension = nombre.includes('.') ? nombre.split('.').pop()!.toLowerCase() : '';
  return POR_EXTENSION[extension] ?? [];
}

const EXPRESIONES: Record<Estilo, RegExp> = {
  // El `(?<![:/])` deja fuera las URLs: `https://…` no es un comentario.
  barras: /(?<![:/])\/\/[^\n]*/g,
  bloque: /\/\*[\s\S]*?\*\//g,
  // Al principio de línea o tras espacios: así un `#fff` de CSS o un `#id`
  // dentro de un atributo no se cuelan.
  almohadilla: /(?:^|\s)#[^\n]*/gm,
  guiones: /(?:^|\s)--\s[^\n]*/gm,
  html: /<!--[\s\S]*?-->/g,
};

/** Todos los comentarios de un archivo, en bruto y en orden. */
export function comentariosDe(ruta: string, contenido: string): string[] {
  const encontrados: string[] = [];

  for (const estilo of estilosDe(ruta)) {
    for (const trozo of contenido.match(EXPRESIONES[estilo]) ?? []) {
      encontrados.push(trozo.trim());
    }
  }

  return encontrados;
}

/**
 * ¿Este archivo lleva prosa dentro?
 *
 * Un comentario de una sola palabra —`// TODO`, `/* main *\/`— no es una frase
 * que haya que traducir, y obligar a duplicarlo en dos idiomas solo añadiría
 * ruido al JSON. A partir de dos palabras ya es lenguaje.
 */
export function tieneProsa(ruta: string, contenido: string): boolean {
  return comentariosDe(ruta, contenido).some((comentario) => palabras(comentario) >= 2);
}

/**
 * El archivo sin sus comentarios, para comparar traducciones.
 *
 * Lo que cambia entre idiomas tiene que ser **solo** la prosa: si al traducir
 * se cuela un identificador o un literal distinto, la lección funciona en un
 * idioma y falla en el otro — y falla contra las reglas, que se escriben una
 * sola vez. Quitando los comentarios, las dos versiones deben ser idénticas.
 */
export function sinComentarios(ruta: string, contenido: string): string {
  let salida = contenido;

  // De mayor a menor: quitar `//` primero dejaría suelto el texto de los
  // comentarios largos, y ya no coincidirían.
  const comentarios = [...comentariosDe(ruta, contenido)].sort((a, b) => b.length - a.length);
  for (const comentario of comentarios) salida = salida.split(comentario).join('');

  return salida.replace(/\s+/g, ' ').trim();
}

/**
 * ¿Este texto sigue estando en castellano?
 *
 * El fallo natural al añadir el segundo idioma es copiar el bloque y traducir
 * media docena de líneas. Esto se aplica **solo a los comentarios** de la
 * versión inglesa, así que un identificador en castellano —`nombre`,
 * `usuarios`— no cuenta: esos no se traducen a propósito, porque las reglas y
 * las salidas esperadas se escriben una sola vez.
 */
export function pareceCastellano(texto: string): boolean {
  return PALABRAS_CASTELLANAS.test(texto);
}

const PALABRAS_CASTELLANAS =
  /(?:^|\s)(?:que|para|los|las|una|con|por|del|cuando|paso|línea|código|archivo)(?:\s|[.,:;]|$)/i;

function palabras(comentario: string): number {
  const limpio = comentario
    .replace(/^\/\/+|^\/\*+|\*+\/$|^<!--|-->$|^#+|^--\s/g, ' ')
    .replace(/[*/]/g, ' ');

  return (limpio.match(/[A-Za-zÀ-ÿ]{2,}/g) ?? []).length;
}
