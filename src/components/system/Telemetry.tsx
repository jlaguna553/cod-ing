'use client';

import { useEffect } from 'react';
import { useReportWebVitals } from 'next/web-vitals';
import { report } from '@/lib/observability/report';

/**
 * Lo que el navegador puede contar y nadie estaba escuchando.
 *
 * Dos cosas, y las dos pasan por el mismo embudo:
 *
 * - **Los errores que se escapan.** `error` y `unhandledrejection` son la
 *   diferencia entre «a veces se queda en blanco» y un informe con nombre de
 *   función. Hasta ahora una excepción en producción no dejaba ni rastro.
 *
 * - **Las métricas de carga reales.** No las de un laboratorio: las del
 *   dispositivo y la red de quien está jugando, que es donde se nota que el
 *   editor pesa.
 *
 * Se monta una vez en el layout y no pinta nada. La función que recibe
 * `useReportWebVitals` está **fuera del componente** a propósito: si cambiara
 * de identidad en cada render, el hook volvería a entregar las métricas ya
 * entregadas y cada una se contaría varias veces.
 */

const METRICAS = new Set(['LCP', 'CLS', 'INP', 'FCP', 'TTFB']);

function anotarVital(metric: { name: string; value: number }) {
  if (!METRICAS.has(metric.name)) return;

  report({
    kind: 'web-vital',
    metric: metric.name as 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB',
    // CLS llega con decimales largos; redondear no pierde nada útil.
    value: Math.round(metric.value * 1000) / 1000,
  });
}

export function Telemetry() {
  useReportWebVitals(anotarVital);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      report({
        kind: 'app-error',
        source: 'window',
        // Solo el mensaje. El `stack` de un bundle minificado no dice nada
        // sin mapas de origen, y esos no se publican.
        message: recortar(event.message || 'Error sin mensaje'),
        lessonId: leccionActual(),
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const razon = event.reason;
      report({
        kind: 'app-error',
        source: 'promise',
        message: recortar(
          razon instanceof Error ? razon.message : String(razon ?? 'Promesa rechazada'),
        ),
        lessonId: leccionActual(),
      });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}

/**
 * En qué lección estaba, sacado de la URL.
 *
 * De la URL y no del store: cuando algo revienta, el store es justo lo que
 * puede estar a medias, y esto tiene que funcionar precisamente entonces.
 */
function leccionActual(): string | undefined {
  const partes = window.location.pathname.split('/');
  const indice = partes.indexOf('play');
  return indice >= 0 ? partes[indice + 2] : undefined;
}

const recortar = (texto: string) => texto.slice(0, 300);
