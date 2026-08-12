import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Envoltorios conscientes del locale. Usa SIEMPRE estos, nunca los de
 * `next/navigation`: `router.replace(pathname)` desde aquí conserva la ruta
 * al cambiar de idioma en lugar de mandar al usuario a la home.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
