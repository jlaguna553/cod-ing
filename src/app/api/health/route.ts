import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { databaseUrl, getDb } from '@/lib/db/client';
import { getAllLessons } from '@/lib/content/loader';
import { log } from '@/lib/observability/log';

/**
 * ¿Está viva la aplicación, y con qué?
 *
 * Contesta las tres preguntas que se hacen cuando algo va mal y no se sabe
 * dónde mirar: **qué versión está desplegada**, **si la base responde** y **si
 * el contenido cargó**. Las tres han fallado alguna vez de formas que la
 * portada no delata: un despliegue que no era el que se creía, una base
 * inalcanzable con la interfaz pintándose igual, y un JSON de lección roto que
 * solo se nota al abrir esa lección.
 *
 * **Es pública y no dice nada que no se pueda decir.** Ni la cadena de
 * conexión ni su host: solo si hay Postgres detrás o se está corriendo sobre
 * PGlite, que es justo lo que hay que saber para no confundir un entorno con
 * otro. Un `/health` que exige una llave es un `/health` que nadie consulta.
 *
 * Devuelve 503 cuando algo falla, para que cualquier vigilante externo
 * —incluido un `curl` en un cron— sepa distinguirlo sin leer el cuerpo.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const empezo = Date.now();

  const base = await comprobarBase();
  const contenido = comprobarContenido();
  const ok = base.ok && contenido.ok;

  const cuerpo = {
    ok,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    entorno: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
    base,
    contenido,
    ms: Date.now() - empezo,
  };

  if (!ok) log.error('health.degraded', { base: base.ok, contenido: contenido.ok });

  return NextResponse.json(cuerpo, {
    status: ok ? 200 : 503,
    // Un estado en caché es un estado mentido.
    headers: { 'cache-control': 'no-store' },
  });
}

async function comprobarBase() {
  const motor = databaseUrl() ? 'postgres' : 'pglite';
  const empezo = Date.now();

  try {
    const db = await getDb();
    await db.execute(sql`SELECT 1`);
    return { ok: true, motor, ms: Date.now() - empezo };
  } catch (cause) {
    return {
      ok: false,
      motor,
      ms: Date.now() - empezo,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

function comprobarContenido() {
  try {
    const lecciones = getAllLessons('es');
    // Cero lecciones no es «vacío»: es que el cargador no encontró el
    // contenido, y la aplicación se pinta igual con un mapa desierto.
    return { ok: lecciones.length > 0, lecciones: lecciones.length };
  } catch (cause) {
    return {
      ok: false,
      lecciones: 0,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
