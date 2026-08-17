/**
 * En qué día vive el usuario.
 *
 * La racha se cortaba a **medianoche UTC**, que para quien juega en México es
 * a las 18:00: una sesión a las siete de la tarde contaba como el día
 * siguiente, y dos sesiones en la misma tarde-noche podían aparecer como dos
 * días seguidos o romper la racha según la hora. Es de esos fallos que solo
 * sufre quien no vive en Londres, y que quien lo escribió no ve nunca.
 *
 * El día es **el del calendario del usuario**, y para eso hace falta su zona
 * horaria — no basta un desfase en minutos: el horario de verano lo cambia dos
 * veces al año y `America/Santiago` no significa lo mismo en enero que en
 * julio. `Intl` ya sabe todo eso; aquí solo se le pregunta.
 *
 * **Se cree lo que dice el navegador.** Mentir en la zona horaria sirve para
 * regalarse un día de racha a uno mismo, y no afecta a nadie más: no es una
 * defensa que valga la pena montar. Lo que sí se comprueba es que la zona
 * exista, para que un valor inventado no reviente la petición.
 */

/** Zona horaria por defecto cuando el cliente no la manda o manda una falsa. */
export const ZONA_POR_DEFECTO = 'UTC';

/**
 * ¿Es un nombre de zona horaria que el runtime entiende?
 *
 * Se pregunta construyendo un formateador: es la única forma fiable, porque la
 * lista depende de la versión de ICU que traiga el entorno.
 */
export function esZonaValida(zona: string): boolean {
  if (!zona || zona.length > 64) return false;

  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

/**
 * El día del calendario (`YYYY-MM-DD`) en esa zona, para ese instante.
 *
 * `en-CA` no es capricho: es el locale cuyo formato de fecha corto ya es
 * ISO. Construirlo a mano con `getFullYear` y compañía daría el día del
 * servidor, que es justo lo que se quiere evitar.
 */
export function localDay(zona: string = ZONA_POR_DEFECTO, at: Date = new Date()): string {
  const segura = esZonaValida(zona) ? zona : ZONA_POR_DEFECTO;

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: segura,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** El día anterior a uno dado. Trabaja sobre la fecha, no sobre el reloj. */
export function diaAnterior(dia: string): string {
  /*
   * Se calcula a mediodía UTC y no a medianoche.
   *
   * Restar 24 horas a `2026-03-01T00:00:00Z` funciona, pero deja el resultado
   * pegado al borde del día: cualquier ajuste de zona lo empuja al día
   * equivocado. Desde el mediodía sobran doce horas de margen en cada
   * dirección, que es más de lo que mueve ningún cambio de hora.
   */
  const instante = Date.parse(`${dia}T12:00:00Z`) - 86_400_000;
  return new Date(instante).toISOString().slice(0, 10);
}
