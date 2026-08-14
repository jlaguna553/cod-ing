import 'server-only';
import { cookies } from 'next/headers';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Identidad anónima firmada en cookie.
 *
 * **Por qué no Auth.js todavía.** Pedir registro antes de dejar escribir una
 * línea de código es la forma más eficaz de perder al usuario en la primera
 * pantalla. La plataforma arranca con una identidad anónima que ya guarda
 * progreso; la cuenta se reclama después y hereda el mismo `id`, porque el
 * campo `email` de `users` es opcional justo para eso.
 *
 * La cookie va firmada con HMAC: sin firma, cambiar su valor en devtools sería
 * suplantar a cualquier usuario cuyo id se conozca. La firma no da
 * confidencialidad —el id es visible— pero sí integridad, que es lo que hace
 * falta aquí.
 */

const COOKIE = 'cq_uid';
const MAX_AGE = 60 * 60 * 24 * 365;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (value) return value;

  // En producción sin secreto configurado, fallar es preferible a firmar con
  // una clave conocida y aparentar seguridad.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET es obligatorio en producción');
  }
  return 'dev-only-insecure-secret';
}

function sign(id: string): string {
  return createHmac('sha256', secret()).update(id).digest('base64url');
}

export function serializeSession(id: string): string {
  return `${id}.${sign(id)}`;
}

/** Verifica la firma en tiempo constante. Devuelve el id o null. */
export function parseSession(raw: string | undefined): string | null {
  if (!raw) return null;

  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return null;

  const id = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  const expected = sign(id);

  if (signature.length !== expected.length) return null;
  try {
    const ok = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    return ok ? id : null;
  } catch {
    return null;
  }
}

/** Id de la petición actual, creando una identidad nueva si hace falta. */
export async function getOrCreateUserId(): Promise<{ id: string; isNew: boolean }> {
  const store = await cookies();
  const existing = parseSession(store.get(COOKIE)?.value);
  if (existing) return { id: existing, isNew: false };

  const id = `anon_${randomUUID()}`;
  store.set(COOKIE, serializeSession(id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE,
    path: '/',
  });

  return { id, isNew: true };
}

/**
 * Apunta la sesión a otro usuario. Es lo que hace «iniciar sesión».
 *
 * No hay tabla de sesiones ni token que revocar: la cookie firmada **es** la
 * sesión. Cambiarla de valor es todo el trabajo, y la firma impide que ese
 * cambio lo haga nadie más que el servidor.
 */
export async function setSessionCookie(id: string) {
  const store = await cookies();
  store.set(COOKIE, serializeSession(id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE,
    path: '/',
  });
}

/**
 * Cierra la sesión borrando la cookie.
 *
 * La siguiente petición crea una identidad anónima nueva y vacía. La cuenta no
 * se toca: para eso se reclamó, para poder volver.
 */
export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE);
}

/** Solo lectura: no crea identidad. Para rutas que toleran usuario ausente. */
export async function getUserId(): Promise<string | null> {
  const store = await cookies();
  return parseSession(store.get(COOKIE)?.value);
}

export const SESSION_COOKIE = COOKIE;
