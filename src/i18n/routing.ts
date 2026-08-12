import { defineRouting } from 'next-intl/routing';
import { LOCALES } from '@/lib/content/lesson.schema';

/**
 * Los locales salen del MISMO sitio que valida el contenido bilingüe
 * (`lesson.schema.ts`). Añadir un idioma aquí hace fallar el schema hasta
 * que las lecciones lo incluyan — que es exactamente lo que queremos:
 * ninguna ruta de idioma existe sin contenido detrás.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: 'es',
  // El prefijo siempre visible (/es/..., /en/...) mantiene el locale como
  // parte de la URL: se puede compartir un enlace en un idioma concreto.
  localePrefix: 'always',
});
