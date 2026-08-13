'use client';

import { useTranslations } from 'next-intl';
import { Database, TriangleAlert } from 'lucide-react';
import { useRunnerStore } from '@/stores/useRunnerStore';
import { format } from '@/lib/runners/sql';
import type { SqlResult } from '@/lib/runners/sql';

/**
 * Resultado de la consulta, como lo enseñaría un cliente de base de datos.
 *
 * Una rejilla y no la consola: leer un resultado tabular en texto plano —con
 * las columnas desalineadas en cuanto un valor es largo— es exactamente el
 * trabajo que esta pantalla tiene que ahorrar. La consola sigue existiendo
 * para el error de Postgres, que sí es texto.
 */
export function SqlResultGrid() {
  const t = useTranslations();
  const lastResult = useRunnerStore((s) => s.lastResult);
  const status = useRunnerStore((s) => s.status);

  const result = (lastResult?.artifacts?.sql ?? null) as SqlResult | null;

  if (status === 'booting') return null;

  if (!lastResult) {
    return (
      <Centered>
        <Database size={18} className="text-[var(--color-ink-faint)]" />
        <p>{t('sql.runToSee')}</p>
      </Centered>
    );
  }

  // La consulta falló: el mensaje de Postgres, tal cual, en su sitio.
  if (!result) {
    return (
      <div className="h-full overflow-auto p-4">
        <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-damage)]">
          <TriangleAlert size={12} />
          {t('sql.error')}
        </p>
        <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
          {lastResult.stderr}
        </pre>
      </div>
    );
  }

  if (result.columns.length === 0) {
    return (
      <Centered>
        <p>{t('sql.affected', { count: result.rowCount })}</p>
      </Centered>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* El scroll horizontal vive aquí dentro: una tabla ancha no debe empujar el panel. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead className="sticky top-0 bg-[var(--color-raised)]">
            <tr>
              {result.columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="border-b border-[var(--color-border)] px-3 py-2 text-left font-semibold text-[var(--color-neon)]"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, index) => (
              <tr key={index} className="odd:bg-[var(--color-abyss)]/40">
                {result.columns.map((column) => {
                  const value = row[column];
                  const isNull = value === null || value === undefined;
                  return (
                    <td
                      key={column}
                      className={
                        'whitespace-nowrap border-b border-[var(--color-border)]/40 px-3 py-1.5 ' +
                        // `NULL` atenuado y en cursiva: no es el texto "NULL",
                        // y confundirlos es la mitad de una lección entera.
                        (isNull
                          ? 'italic text-[var(--color-ink-faint)]'
                          : 'text-[var(--color-ink-dim)]')
                      }
                    >
                      {format(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="shrink-0 border-t border-[var(--color-border)] px-3 py-1.5 font-mono text-[10px] text-[var(--color-ink-faint)]">
        {t('sql.rowCount', { count: result.rows.length })}
      </p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-[var(--color-ink-faint)]">
      {children}
    </div>
  );
}
