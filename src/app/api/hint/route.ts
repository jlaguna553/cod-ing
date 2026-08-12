import { NextResponse } from 'next/server';
import { hasLocale } from 'next-intl';
import { getHintText } from '@/lib/content/loader';
import { routing } from '@/i18n/routing';

/**
 * Entrega el texto de UNA pista, ya localizada.
 *
 * Existe para que las pistas no viajen dentro del payload de la lección: si
 * viajaran, costarían XP de mentira, porque bastaría con mirar el HTML.
 *
 * Es también el punto donde la Fase 7 descontará el XP de verdad, en el
 * servidor. Hasta entonces el descuento es solo local, y por tanto falseable
 * — pero el texto de la pista ya no lo es, que es lo que importa asegurar
 * primero: el secreto no se puede "des-filtrar" después.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  const { lessonId, hintId, locale } = (body ?? {}) as Record<string, unknown>;

  if (typeof lessonId !== 'string' || typeof hintId !== 'string') {
    return NextResponse.json({ error: 'missing-params' }, { status: 400 });
  }
  if (!hasLocale(routing.locales, locale)) {
    return NextResponse.json({ error: 'invalid-locale' }, { status: 400 });
  }

  const text = getHintText(lessonId, hintId, locale);
  if (text === null) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  return NextResponse.json({ text });
}
