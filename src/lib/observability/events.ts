import 'server-only';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/lib/db/client';
import { events } from '@/lib/db/schema';

/**
 * Eventos de observabilidad: qué se acepta, cómo se guarda y qué se saca.
 *
 * La regla que ordena todo este archivo: **el cliente no decide qué se
 * guarda**. Manda un tipo de una lista cerrada y unos pocos campos acotados;
 * lo que no encaja se descarta sin drama y sin contarle al emisor qué habría
 * encajado. Una tabla que acepta lo que le llegue es un vertedero con índices.
 */

/** Longitud máxima de cualquier texto que llegue del cliente. */
const MAX_TEXTO = 300;

const texto = z.string().trim().min(1).max(MAX_TEXTO);

/**
 * Los cuatro tipos que se recogen, y por qué cada uno.
 *
 * - `app-error`: una excepción que escapó en el navegador. Es lo único que
 *   convierte «a veces se queda en blanco» en un informe con nombre.
 * - `runner-error`: el motor de la lección no arrancó o reventó. Distinguirlo
 *   de lo anterior importa: aquí lo que falla es *nuestro* runtime, y el
 *   usuario se queda sin poder ejecutar nada.
 * - `step-attempt`: un intento de resolver un paso, con las reglas que
 *   fallaron. Es la señal de calidad del contenido: un paso donde todo el
 *   mundo falla la misma regla no es un paso difícil, es un enunciado malo.
 * - `web-vital`: una métrica de carga real, de navegador real.
 */
export const EventoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('app-error'),
    message: texto,
    source: z.enum(['window', 'promise', 'react']),
    lessonId: texto.optional(),
  }),
  z.object({
    kind: z.literal('runner-error'),
    message: texto,
    runtime: texto,
    phase: z.enum(['boot', 'run']),
    lessonId: texto.optional(),
  }),
  z.object({
    kind: z.literal('step-attempt'),
    lessonId: texto,
    stepIndex: z.number().int().min(0).max(99),
    passed: z.boolean(),
    /** Reglas que fallaron. Solo identificadores: nunca el código escrito. */
    failedRuleIds: z.array(texto).max(12).default([]),
  }),
  z.object({
    kind: z.literal('web-vital'),
    metric: z.enum(['LCP', 'CLS', 'INP', 'FCP', 'TTFB']),
    value: z.number().min(0).max(600_000),
  }),
]);

export type Evento = z.infer<typeof EventoSchema>;

/** Tope por petición: un lote grande es un error o un abuso, no telemetría. */
export const MAX_LOTE = 20;

export const LoteSchema = z.object({ events: z.array(EventoSchema).min(1).max(MAX_LOTE) });

/**
 * Guarda un lote.
 *
 * `lessonId` y `stepIndex` suben a columna propia porque son por lo que se
 * pregunta —«qué falla en esta lección»— y en `jsonb` cada consulta tendría
 * que escarbar. El resto se queda en `payload`, que es donde vive lo que
 * cambia de un tipo a otro.
 */
export async function recordEvents(
  db: Database,
  userId: string | null,
  lote: Evento[],
): Promise<number> {
  if (lote.length === 0) return 0;

  await db.insert(events).values(
    lote.map((evento) => {
      const { kind, ...resto } = evento;
      const lessonId = 'lessonId' in evento ? (evento.lessonId ?? null) : null;
      const stepIndex = 'stepIndex' in evento ? evento.stepIndex : null;

      return { kind, userId, lessonId, stepIndex, payload: resto as Record<string, unknown> };
    }),
  );

  return lote.length;
}

/**
 * Retención: 30 días.
 *
 * La tabla crece con cada visita y el plan gratuito de la base tiene un
 * tamaño. Treinta días son más de lo que se tarda en enterarse de un problema
 * y menos de lo que hace falta para llenar nada. Se hace aquí y no con un cron
 * porque un cron es otro servicio que mantener; el coste de un `DELETE` con
 * índice, cada muchas escrituras, es despreciable.
 */
export const RETENCION_DIAS = 30;

export async function pruneEvents(db: Database, ahora = new Date()): Promise<void> {
  const limite = new Date(ahora.getTime() - RETENCION_DIAS * 86_400_000);
  await db.delete(events).where(lt(events.createdAt, limite));
}

export interface Resumen {
  desde: string;
  totalEventos: number;
  /** Errores agrupados por mensaje, de más repetido a menos. */
  errores: Array<{ kind: string; message: string; veces: number; ultimo: string }>;
  /** Pasos con intentos fallidos, de peor tasa de acierto a mejor. */
  pasosDuros: Array<{
    lessonId: string;
    stepIndex: number;
    intentos: number;
    superados: number;
    reglaMasFallada: string | null;
  }>;
}

/**
 * Lo que de verdad se quiere mirar, ya agregado.
 *
 * Se calcula en SQL y no en JavaScript porque traerse cien mil filas para
 * contarlas es exactamente el trabajo que la base sabe hacer sin moverlas.
 */
export async function summarize(db: Database, dias = 7, ahora = new Date()): Promise<Resumen> {
  const desde = new Date(ahora.getTime() - dias * 86_400_000);

  const [total] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(gte(events.createdAt, desde));

  const errores = await db
    .select({
      kind: events.kind,
      message: sql<string>`${events.payload} ->> 'message'`,
      veces: sql<number>`count(*)::int`,
      ultimo: sql<string>`max(${events.createdAt})::text`,
    })
    .from(events)
    .where(and(gte(events.createdAt, desde), sql`${events.kind} LIKE '%-error'`))
    .groupBy(events.kind, sql`${events.payload} ->> 'message'`)
    .orderBy(desc(sql`count(*)`))
    .limit(20);

  const intentos = await db
    .select({
      lessonId: events.lessonId,
      stepIndex: events.stepIndex,
      intentos: sql<number>`count(*)::int`,
      superados: sql<number>`count(*) filter (where ${events.payload} ->> 'passed' = 'true')::int`,
      reglaMasFallada: sql<string | null>`(
        SELECT regla FROM (
          SELECT jsonb_array_elements_text(e2.payload -> 'failedRuleIds') AS regla
          FROM events e2
          WHERE e2.kind = 'step-attempt'
            AND e2.lesson_id = ${events.lessonId}
            AND e2.step_index = ${events.stepIndex}
            AND e2.created_at >= ${desde}
        ) reglas
        GROUP BY regla
        ORDER BY count(*) DESC
        LIMIT 1
      )`,
    })
    .from(events)
    .where(and(gte(events.createdAt, desde), eq(events.kind, 'step-attempt')))
    .groupBy(events.lessonId, events.stepIndex)
    .orderBy(sql`count(*) filter (where ${events.payload} ->> 'passed' = 'true')::float / count(*)`)
    .limit(20);

  return {
    desde: desde.toISOString(),
    totalEventos: total?.n ?? 0,
    errores: errores.map((fila) => ({
      kind: fila.kind,
      message: fila.message ?? '(sin mensaje)',
      veces: fila.veces,
      ultimo: fila.ultimo,
    })),
    pasosDuros: intentos.map((fila) => ({
      lessonId: fila.lessonId ?? '(desconocida)',
      stepIndex: fila.stepIndex ?? 0,
      intentos: fila.intentos,
      superados: fila.superados,
      reglaMasFallada: fila.reglaMasFallada,
    })),
  };
}
