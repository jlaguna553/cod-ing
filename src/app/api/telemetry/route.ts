import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { getUserId } from '@/lib/auth/session';
import { LoteSchema, pruneEvents, recordEvents } from '@/lib/observability/events';
import { log } from '@/lib/observability/log';

/**
 * Recogida de telemetría del navegador.
 *
 * Tres decisiones que la hacen segura de dejar abierta:
 *
 * 1. **La identidad no se acepta, se lee.** El `userId` sale de la cookie
 *    firmada; si el cliente mandara el suyo, cualquiera podría atribuirle
 *    errores a otro. Sin sesión se guarda el evento con `null`: un error de un
 *    visitante que nunca llegó a jugar sigue siendo un error que quiero ver.
 *
 * 2. **Nunca crea usuario.** Se usa `getUserId`, que solo lee. Un beacon de
 *    telemetría no puede ser lo que dé de alta a nadie.
 *
 * 3. **Responde 204 pase lo que pase.** Es un beacon: nadie está esperando la
 *    respuesta, y devolver un 400 explicando qué campo sobraba solo sirve para
 *    que alguien averigüe qué acepta el endpoint. Lo inválido se descarta y se
 *    cuenta en el log del servidor, que es donde sí interesa.
 */

/** 1 de cada 50 escrituras limpia lo viejo. Ver `RETENCION_DIAS`. */
const PROBABILIDAD_PODA = 0.02;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const parsed = LoteSchema.safeParse(body);
  if (!parsed.success) {
    log.warn('telemetry.rejected', { issues: parsed.error.issues.length });
    return new NextResponse(null, { status: 204 });
  }

  try {
    const userId = await getUserId();
    const db = await getDb();

    const guardados = await recordEvents(db, userId, parsed.data.events);

    /*
     * Los errores se registran **también** en el log del servidor.
     *
     * La tabla sirve para agregar y comparar; el log, para enterarse. Un fallo
     * del runtime en producción no debería esperar a que alguien abra un panel.
     */
    for (const evento of parsed.data.events) {
      if (evento.kind === 'app-error' || evento.kind === 'runner-error') {
        log.error(evento.kind, {
          message: evento.message,
          lesson: 'lessonId' in evento ? evento.lessonId : undefined,
          runtime: 'runtime' in evento ? evento.runtime : undefined,
          phase: 'phase' in evento ? evento.phase : undefined,
          userId: userId ?? undefined,
        });
      }
    }

    if (Math.random() < PROBABILIDAD_PODA) await pruneEvents(db);

    log.info('telemetry.stored', { count: guardados });
  } catch (cause) {
    // Que falle la telemetría no puede romper nada de lo que el usuario hace.
    log.error('telemetry.failed', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }

  return new NextResponse(null, { status: 204 });
}
