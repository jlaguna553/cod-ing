import 'server-only';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Contraseñas y códigos de recuperación.
 *
 * **scrypt de `node:crypto`, no bcrypt ni argon2.** Las dos alternativas son
 * buenas y las dos son dependencias nativas que hay que compilar; scrypt viene
 * en la plataforma, está diseñado para esto y no añade nada al despliegue. Para
 * el volumen de esta aplicación la diferencia práctica es ninguna.
 *
 * Los parámetros van **dentro del hash**. Subirlos el día que compense no
 * invalida lo ya guardado: cada hash dice con qué coste se calculó, así que los
 * viejos se siguen verificando y solo los nuevos usan el coste nuevo. Un formato
 * que no guarda sus parámetros obliga a caducar todas las contraseñas a la vez.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/** ~16 MB y unos 50 ms por hash. Suficiente para que la fuerza bruta duela. */
const COST = { N: 16_384, r: 8, p: 1 };
const KEYLEN = 64;

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(secret, salt, KEYLEN, COST);
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

/**
 * Verifica en tiempo constante.
 *
 * Con `===` el número de bytes comparados depende de cuántos coinciden, y esa
 * diferencia de tiempo es medible: se puede adivinar un hash byte a byte. Aquí
 * no es explotable en la práctica —el atacante tendría que conocer ya el hash—
 * pero el hábito importa más que el caso.
 */
export async function verifySecret(secret: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, salt, expected] = parts;
  let derived: Buffer;
  try {
    derived = await scryptAsync(secret, Buffer.from(salt, 'base64url'), KEYLEN, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, 'base64url');
  if (expectedBuffer.length !== derived.length) return false;
  return timingSafeEqual(derived, expectedBuffer);
}

/*
 * Alfabeto sin `0/O`, `1/I/L` ni `U`: el código se lee de una pantalla y se
 * escribe a mano, y esas confusiones son el motivo número uno de que un código
 * de recuperación «no funcione». Quitarlas cuesta cuatro caracteres de entropía
 * y ahorra el peor rato posible.
 */
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Código de recuperación legible: 4 grupos de 4. ~78 bits. */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(16);
  const chars = [...bytes].map((byte) => ALFABETO[byte % ALFABETO.length]);
  return [0, 4, 8, 12].map((inicio) => chars.slice(inicio, inicio + 4).join('')).join('-');
}

/** Acepta el código con o sin guiones, en cualquier caja. */
export function normalizeRecoveryCode(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
