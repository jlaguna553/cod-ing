import 'server-only';

/**
 * Freno a la fuerza bruta en el formulario de entrada.
 *
 * **Es un contador en memoria del proceso, y eso tiene un límite honesto**: en
 * serverless cada instancia lleva el suyo, así que quien reparta los intentos
 * entre instancias consigue más de los que pone el número. No es un control de
 * seguridad completo — es lo que corta el caso real, alguien probando
 * contraseñas desde una pestaña, sin añadir Redis ni ningún servicio de pago.
 *
 * Lo que sí protege de verdad contra el ataque paciente es el coste de scrypt:
 * ~50 ms por intento hacen inviable recorrer un diccionario, con freno o sin él.
 */

const VENTANA_MS = 15 * 60 * 1000;
const MAX_INTENTOS = 8;

const intentos = new Map<string, { fallos: number; desde: number }>();

/** ¿Puede intentarlo? Consulta sin efectos. */
export function isThrottled(key: string, now = Date.now()): boolean {
  const registro = intentos.get(key);
  if (!registro) return false;
  if (now - registro.desde > VENTANA_MS) {
    intentos.delete(key);
    return false;
  }
  return registro.fallos >= MAX_INTENTOS;
}

export function recordFailure(key: string, now = Date.now()) {
  const registro = intentos.get(key);
  if (!registro || now - registro.desde > VENTANA_MS) {
    intentos.set(key, { fallos: 1, desde: now });
    return;
  }
  registro.fallos++;
}

/** Un acierto limpia la cuenta: el freno castiga fallos, no al usuario. */
export function clearFailures(key: string) {
  intentos.delete(key);
}

/** Solo para tests. */
export function resetThrottle() {
  intentos.clear();
}
