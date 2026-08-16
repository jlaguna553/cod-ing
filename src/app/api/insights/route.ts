import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { summarize } from '@/lib/observability/events';
import { log } from '@/lib/observability/log';

/**
 * El resumen de lo recogido: errores repetidos y pasos donde la gente encalla.
 *
 * **Con llave, y de las que se pueden quitar.** Necesita `INSIGHTS_TOKEN` en
 * el entorno; sin esa variable la ruta responde 404 y no existe. Es preferible
 * a esconderla en una URL rara: una ruta secreta se filtra en el primer enlace
 * compartido, y un panel de administración detrás de roles es un sistema de
 * permisos entero que aquí todavía no hace falta.
 *
 * No devuelve nada de nadie en particular: mensajes de error agregados y tasas
 * de acierto por paso. Aun así va protegida, porque «qué se rompe y dónde» es
 * información operativa, no contenido.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const esperado = process.env.INSIGHTS_TOKEN;

  // Sin token configurado la ruta no existe: mejor que existir sin protección.
  if (!esperado) return new NextResponse(null, { status: 404 });

  const url = new URL(request.url);
  const recibido =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    url.searchParams.get('token') ??
    '';

  if (!coincide(recibido, esperado)) {
    log.warn('insights.denied', {});
    return new NextResponse(null, { status: 404 });
  }

  const dias = Math.min(Math.max(Number(url.searchParams.get('dias') ?? 7), 1), 90);
  const resumen = await summarize(await getDb(), dias);

  return NextResponse.json(resumen, { headers: { 'cache-control': 'no-store' } });
}

/** Comparación en tiempo constante, con las longitudes ya igualadas. */
function coincide(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;

  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
