import createMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';

/**
 * Next 16 renombró la convención `middleware.ts` → `proxy.ts`. El handler de
 * next-intl es el mismo: detecta el locale (cookie → cabecera Accept-Language
 * → defaultLocale) y redirige `/` a `/es` o `/en`.
 */
export default createMiddleware(routing);

export const config = {
  // Todo salvo API, internos de Next y ficheros con extensión.
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
