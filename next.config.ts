import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Cross-origin isolation SOLO donde hace falta (ADR-04, revisado por ADR-07).
 *
 * WebContainers exige COOP:same-origin + COEP:require-corp para poder usar
 * SharedArrayBuffer. Aplicarlo a toda la app rompería fuentes, imágenes y
 * cualquier embed de terceros.
 *
 * La primera versión lo aplicaba por track (`/play/backend`, `/play/devops`).
 * Dejó de valer al añadir la terminal interactiva: hay lecciones de FRONTEND
 * que arrancan un WebContainer (instalar Vite desde la consola) y lecciones de
 * backend que no. El criterio correcto es el runtime de la lección, no su track.
 */
const CROSS_ORIGIN_ISOLATION = [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

/**
 * Rutas de lección que arrancan un WebContainer, leídas del contenido en
 * tiempo de build. Se lee el JSON en crudo a propósito: `next.config.ts` se
 * evalúa antes que los alias de módulo, y el loader importa `server-only`.
 */
function webContainerRoutes(): { track: string; lesson: string }[] {
  const root = path.join(process.cwd(), 'content', 'lessons');

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith('.lesson.json') ? [full] : [];
    });
  }

  return walk(root)
    .map((file) => JSON.parse(readFileSync(file, 'utf8')))
    .filter((lesson) => lesson.runtime?.kind === 'webcontainer')
    .map((lesson) => ({ track: lesson.track, lesson: lesson.id }));
}

const nextConfig: NextConfig = {
  /**
   * PGlite lleva un binario WASM que el bundler rompe al empaquetarlo
   * (`instantiateWasm is not a function`). Se deja fuera del bundle para que
   * se cargue como paquete de Node en tiempo de ejecución.
   */
  serverExternalPackages: ['@electric-sql/pglite'],
  async headers() {
    return webContainerRoutes().map(({ track, lesson }) => ({
      source: `/:locale/play/${track}/${lesson}`,
      headers: CROSS_ORIGIN_ISOLATION,
    }));
  },
};

export default withNextIntl(nextConfig);
