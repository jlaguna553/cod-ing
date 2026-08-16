import type { Instrumentation } from 'next';

/**
 * Errores del servidor que antes no dejaban rastro.
 *
 * Next llama a `onRequestError` con **cualquier** excepción que capture: la de
 * una ruta de API, la de un componente de servidor a medio renderizar, la de
 * un `generateStaticParams`. Sin este gancho, un fallo en producción se veía
 * como una pantalla de error genérica y nada más — para reproducirlo había que
 * adivinar qué estaba haciendo el usuario.
 *
 * No hay servicio al que mandarlo: se escribe en la salida estándar, que es lo
 * que Vercel recoge y enseña sin cobrar por ello. El `digest` se incluye
 * porque es lo que Next enseña **al usuario** en la pantalla de error: es el
 * único hilo que une «me sale un código raro» con la línea del log.
 *
 * Se registra a mano y no se re-lanza: esto observa, no decide.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const mensaje = error instanceof Error ? error.message : String(error);
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error
      ? String((error as { digest?: unknown }).digest)
      : undefined;

  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      event: 'server-error',
      message: mensaje,
      digest,
      path: request.path,
      method: request.method,
      // `routerKind`/`routeType` distinguen una ruta de API de un render de
      // página: el mismo mensaje significa cosas distintas en cada sitio.
      router: context.routerKind,
      routeType: context.routeType,
      routePath: context.routePath,
    }),
  );
};
