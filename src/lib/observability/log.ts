import 'server-only';

/**
 * Registro estructurado del servidor.
 *
 * Una línea por evento y en JSON, no en prosa. La diferencia importa el día
 * que hay que buscar algo: `grep` sobre «error al guardar progreso de usuario
 * anon_3f2…» encuentra lo que ya sabías buscar, mientras que un campo `event`
 * se puede filtrar, contar y agrupar sin escribir una expresión regular.
 *
 * **Sale por `stdout` y ahí se queda.** No hay servicio de terceros al que
 * mandar nada: Vercel recoge la salida estándar y la enseña en su panel, que
 * viene incluido y no cuesta dinero. El día que haga falta retención larga,
 * este es el único sitio que cambia.
 *
 * ## Qué no se registra, nunca
 *
 * - **El código del usuario.** Puede contener cualquier cosa que haya
 *   tecleado, incluida una contraseña pegada por error en un ejercicio.
 * - **El correo ni la contraseña**, obviamente, ni el hash.
 * - **La cookie de sesión.** El `userId` sí, porque es la única forma de
 *   distinguir «un usuario con un problema repetido» de «cien usuarios».
 */

type Nivel = 'info' | 'warn' | 'error';

/** Campos que acompañan a un evento. Valores planos: esto acaba en una línea. */
export type Campos = Record<string, string | number | boolean | null | undefined>;

function emitir(nivel: Nivel, event: string, campos: Campos = {}) {
  const linea = JSON.stringify({
    ts: new Date().toISOString(),
    level: nivel,
    event,
    ...campos,
  });

  // `console` y no un cliente propio: es lo que Vercel captura, y en local es
  // lo que sale en la terminal donde ya se está mirando.
  if (nivel === 'error') console.error(linea);
  else if (nivel === 'warn') console.warn(linea);
  else console.log(linea);
}

export const log = {
  info: (event: string, campos?: Campos) => emitir('info', event, campos),
  warn: (event: string, campos?: Campos) => emitir('warn', event, campos),
  error: (event: string, campos?: Campos) => emitir('error', event, campos),
};

/**
 * Envuelve el manejador de una ruta para medirla y registrar su desenlace.
 *
 * Registra **siempre**, no solo cuando falla: sin la línea del caso bueno no
 * hay con qué comparar, y «esto va lento» se queda en una impresión. El error
 * se re-lanza tal cual — esto observa, no decide.
 */
export async function observarRuta<T>(
  ruta: string,
  handler: () => Promise<T>,
): Promise<T> {
  const empezo = Date.now();

  try {
    const respuesta = await handler();
    const status =
      respuesta instanceof Response ? respuesta.status : 200;

    log.info('http', { route: ruta, status, ms: Date.now() - empezo });
    return respuesta;
  } catch (cause) {
    log.error('http', {
      route: ruta,
      status: 500,
      ms: Date.now() - empezo,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    throw cause;
  }
}
