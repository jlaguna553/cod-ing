import { NextResponse } from 'next/server';
import { observarRuta } from '@/lib/observability/log';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { ensureUser } from '@/lib/db/queries';
import {
  MIN_PASSWORD,
  authenticate,
  claimAccount,
  getAccount,
  mergeAccounts,
  resetWithRecoveryCode,
} from '@/lib/auth/account';
import {
  clearSessionCookie,
  getOrCreateUserId,
  getUserId,
  setSessionCookie,
} from '@/lib/auth/session';
import { clearFailures, isThrottled, recordFailure } from '@/lib/auth/throttle';

/**
 * Cuenta: reclamar, entrar, salir y recuperar.
 *
 * Las cuatro acciones viven en una sola ruta con un campo `action` porque
 * comparten todo lo demás —validación, freno, cookie— y separarlas en cuatro
 * archivos sería repetir ese contorno cuatro veces.
 *
 * `GET` devuelve quién eres. Lo usa la tarjeta de cuenta para saber qué pintar
 * sin adivinar desde el cliente.
 */

const Credenciales = {
  email: z.string().trim().min(3).max(254),
  password: z.string().min(MIN_PASSWORD).max(200),
};

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim'), ...Credenciales }),
  z.object({ action: z.literal('login'), ...Credenciales }),
  z.object({ action: z.literal('logout') }),
  z.object({ action: z.literal('recover'), ...Credenciales, code: z.string().min(8).max(40) }),
]);

async function manejarGet() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ email: null, anonymous: true });

  const cuenta = await getAccount(await getDb(), userId);
  return NextResponse.json({
    email: cuenta?.email ?? null,
    anonymous: cuenta?.anonymous ?? true,
  });
}

async function manejarPost(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    /*
     * La contraseña corta llega aquí, no al validador de negocio: el schema la
     * rechaza antes. Se distingue para poder decir *por qué* — «datos
     * inválidos» ante una contraseña de 6 caracteres deja al usuario probando
     * a ciegas.
     */
    const corta = parsed.error.issues.some((issue) => issue.path[0] === 'password');
    return NextResponse.json(
      { error: corta ? 'weak-password' : 'invalid-request', minPassword: MIN_PASSWORD },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const db = await getDb();

  if (body.action === 'logout') {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'claim') {
    const { id: userId } = await getOrCreateUserId();
    await ensureUser(db, userId);

    const resultado = await claimAccount(db, userId, body);
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.error }, { status: 400 });
    }

    // El código se enseña **una sola vez**: no se guarda en claro en ninguna
    // parte, así que este es el único momento en que existe legible.
    return NextResponse.json({ ok: true, email: body.email.trim().toLowerCase(), recoveryCode: resultado.recoveryCode });
  }

  /*
   * Entrar y recuperar comparten freno. La clave es el correo y no la IP: la
   * IP la comparte media oficina y bloquearla castiga a quien no ha hecho nada,
   * mientras que el ataque que importa aquí va contra una cuenta concreta.
   */
  const clave = `${body.action}:${body.email.trim().toLowerCase()}`;
  if (isThrottled(clave)) {
    return NextResponse.json({ error: 'too-many-attempts' }, { status: 429 });
  }

  const resultado =
    body.action === 'login'
      ? await authenticate(db, body)
      : await resetWithRecoveryCode(db, body);

  if (!resultado.ok) {
    recordFailure(clave);
    return NextResponse.json({ error: resultado.error }, { status: 401 });
  }
  clearFailures(clave);

  /*
   * Lo jugado antes de entrar no se tira.
   *
   * Quien ha estado avanzando sin cuenta y entra con la suya esperaría, como
   * mucho, que ese avance «se sume»; lo que nunca esperaría es verlo
   * desaparecer sin aviso al cambiar la cookie de dueño. Se fusiona antes de
   * mover la sesión para que, si algo falla, la cuenta anónima siga siendo la
   * activa y nada se haya perdido.
   */
  const anterior = await getUserId();
  const fusion =
    anterior && anterior !== resultado.userId
      ? await mergeAccounts(db, anterior, resultado.userId)
      : { lessons: 0, achievements: 0 };

  await setSessionCookie(resultado.userId);

  return NextResponse.json({
    ok: true,
    email: body.email.trim().toLowerCase(),
    mergedLessons: fusion.lessons,
    ...(body.action === 'recover' && 'recoveryCode' in resultado
      ? { recoveryCode: resultado.recoveryCode }
      : {}),
  });
}

/*
 * Cada ruta sale con su duración y su código en el log.
 * Registrar solo los fallos deja «esto va lento» en una impresión: sin la
 * línea del caso bueno no hay con qué comparar.
 */
export const GET = () =>
  observarRuta('auth:GET', () => manejarGet());

export const POST = (request: Request) =>
  observarRuta('auth:POST', () => manejarPost(request));
