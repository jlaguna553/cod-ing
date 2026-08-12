'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, CircleDashed, FlaskConical, TriangleAlert, X } from 'lucide-react';
import { Panel } from '@/components/layout/GameShell';
import { useEvaluationStore, useStepChecks } from '@/stores/useEvaluationStore';

/**
 * Lista de comprobaciones del paso, con tres estados y no dos.
 *
 * «Pendiente» es tan importante como «superada» o «fallida»: una regla que
 * todavía no puede juzgarse —porque no se ha ejecutado el código, o porque
 * está a medio escribir— se muestra en gris. Pintarla en rojo mientras el
 * usuario aún no ha tenido ocasión de acertar es la forma más rápida de que
 * deje de mirar este panel.
 */
export function TestResultList() {
  const t = useTranslations();
  const checks = useStepChecks();
  const stepPassed = useEvaluationStore((s) => s.stepPassed);
  const syntaxError = useEvaluationStore((s) => s.syntaxError);

  const passed = checks.filter((check) => check.result?.passed).length;
  const total = checks.length;

  if (total === 0) {
    return (
      <Panel title={<span className="flex items-center gap-2"><FlaskConical size={13} /> {t('panels.tests')}</span>}>
        <p className="text-xs text-[var(--color-ink-faint)]">{t('tests.none')}</p>
      </Panel>
    );
  }

  return (
    <Panel
      title={<span className="flex items-center gap-2"><FlaskConical size={13} /> {t('panels.tests')}</span>}
      action={
        <span
          className="font-mono text-[10px]"
          style={{ color: stepPassed ? 'var(--color-success)' : 'var(--color-ink-faint)' }}
        >
          {passed}/{total}
        </span>
      }
    >
      <div className="flex flex-col gap-1.5">
        {/*
          Un archivo que no compila deja todas las comprobaciones en gris. Sin
          este aviso, el usuario ve círculos vacíos y no tiene forma de saber
          que le falta un paréntesis o sobra una palabra.
        */}
        {syntaxError && (
          <div className="mb-1 rounded-md border border-[var(--color-damage)]/50 bg-[var(--color-damage)]/10 px-2.5 py-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-damage)]">
              <TriangleAlert size={12} />
              {t('tests.syntaxError', { line: syntaxError.line })}
            </p>
            <p className="mt-1 font-mono text-[10px] leading-snug text-[var(--color-ink-dim)]">
              {syntaxError.message}
            </p>
            <p className="mt-1 text-[10px] text-[var(--color-ink-faint)]">
              {t('tests.syntaxHint')}
            </p>
          </div>
        )}

        {stepPassed && (
          <p className="mb-1 rounded-md border border-[var(--color-success)]/40 bg-[var(--color-success)]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-success)]">
            {t('tests.allPassed')}
          </p>
        )}

        {checks.map(({ rule, result }) => {
          const state = result === null ? 'pending' : result.passed ? 'passed' : 'failed';
          const isWarning = rule.severity === 'warn';

          const color =
            state === 'passed'
              ? 'var(--color-success)'
              : state === 'pending'
                ? 'var(--color-ink-faint)'
                : isWarning
                  ? 'var(--color-power)'
                  : 'var(--color-damage)';

          return (
            <div
              key={rule.id}
              className="flex items-start gap-2 rounded-md border px-2.5 py-2 transition-colors"
              style={{
                borderColor: state === 'pending' ? 'var(--color-border)' : `color-mix(in srgb, ${color} 35%, transparent)`,
                backgroundColor: state === 'pending' ? 'var(--color-abyss)' : `color-mix(in srgb, ${color} 7%, transparent)`,
              }}
            >
              <span className="mt-0.5 shrink-0" style={{ color }}>
                {state === 'passed' ? (
                  <Check size={12} />
                ) : state === 'pending' ? (
                  <CircleDashed size={12} />
                ) : isWarning ? (
                  <AlertTriangle size={12} />
                ) : (
                  <X size={12} />
                )}
              </span>

              <div className="min-w-0 flex-1">
                {/*
                  Al superar una comprobación NO se reutiliza `message`: está
                  redactado para el fallo. Mostrar «¡Daño! `var` es la forma
                  antigua…» junto a un tick verde se lee como una contradicción.
                  Si la lección no da `successMessage`, se usa un texto neutro y
                  el criterio queda debajo, atenuado.
                */}
                {state === 'passed' && !rule.successMessage ? (
                  <>
                    <p className="text-[12px] leading-snug text-[var(--color-success)]">
                      {t('tests.passed')}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-ink-faint)]">
                      {rule.message}
                    </p>
                  </>
                ) : (
                  <p
                    className="text-[12px] leading-snug"
                    style={{ color: state === 'passed' ? 'var(--color-ink-dim)' : 'var(--color-ink)' }}
                  >
                    {state === 'passed' ? rule.successMessage : rule.message}
                  </p>
                )}

                {/* El diff solo aparece al fallar: al acertar es ruido. */}
                {state === 'failed' && result?.detail && (
                  <dl className="mt-1.5 space-y-0.5 font-mono text-[10px]">
                    {result.detail.expected && (
                      <div className="flex gap-1.5">
                        <dt className="shrink-0 text-[var(--color-ink-faint)]">{t('tests.expected')}</dt>
                        <dd className="truncate text-[var(--color-success)]">{result.detail.expected}</dd>
                      </div>
                    )}
                    {result.detail.actual && (
                      <div className="flex gap-1.5">
                        <dt className="shrink-0 text-[var(--color-ink-faint)]">{t('tests.actual')}</dt>
                        <dd className="truncate text-[var(--color-damage)]">{result.detail.actual}</dd>
                      </div>
                    )}
                  </dl>
                )}

                {state === 'failed' && result?.location && (
                  <p className="mt-1 font-mono text-[10px] text-[var(--color-ink-faint)]">
                    {result.location.file}:{result.location.line}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
