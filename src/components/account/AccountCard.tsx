'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, Copy, KeyRound, LogOut, ShieldCheck, TriangleAlert } from 'lucide-react';

/**
 * Reclamar la cuenta, entrar y recuperarla.
 *
 * La tarjeta se pinta en la portada porque es donde alguien decide «esto lo voy
 * a seguir usando». Dentro de una lección estorbaría: interrumpir a quien está
 * programando para pedirle un correo es la forma de que no lo dé.
 *
 * El estado inicial llega del servidor ya resuelto. Preguntarlo desde el
 * cliente enseñaría «anónimo» durante un instante a quien tiene su sesión
 * abierta, y ver «tu progreso se puede perder» cuando no es verdad asusta sin
 * motivo.
 */

type Modo = 'claim' | 'login' | 'recover';

export function AccountCard({ email: emailInicial }: { email: string | null }) {
  const t = useTranslations('account');
  const router = useRouter();

  const [email, setEmail] = useState(emailInicial);
  const [modo, setModo] = useState<Modo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [fusionadas, setFusionadas] = useState(0);

  async function enviar(formData: FormData) {
    if (!modo) return;
    setEnviando(true);
    setError(null);

    const respuesta = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: modo,
        email: formData.get('email'),
        password: formData.get('password'),
        ...(modo === 'recover' ? { code: formData.get('code') } : {}),
      }),
    });

    const datos = await respuesta.json().catch(() => ({}));
    setEnviando(false);

    if (!respuesta.ok) {
      setError(datos.error ?? 'invalid-request');
      return;
    }

    setEmail(datos.email);
    setModo(null);
    setFusionadas(datos.mergedLessons ?? 0);
    if (datos.recoveryCode) setCodigo(datos.recoveryCode);

    // El progreso de la portada lo pinta el servidor: tras fusionar, lo que se
    // ve en pantalla ya no es lo que hay en la base.
    router.refresh();
  }

  async function salir() {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    setEmail(null);
    setCodigo(null);
    router.refresh();
  }

  if (codigo) return <RecoveryCode code={codigo} onDone={() => setCodigo(null)} />;

  return (
    <section className="rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {email ? (
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--color-success)]" />
          ) : (
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-[var(--color-power)]" />
          )}
          <div>
            <p className="text-sm font-semibold text-[var(--color-ink)]">
              {email ? t('signedIn', { email }) : t('anonymousTitle')}
            </p>
            <p className="mt-1 max-w-lg text-xs leading-relaxed text-[var(--color-ink-dim)]">
              {email ? t('signedInHint') : t('anonymousHint')}
            </p>
            {fusionadas > 0 && (
              <p className="mt-2 text-xs text-[var(--color-success)]">
                {t('merged', { count: fusionadas })}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          {email ? (
            <button
              type="button"
              onClick={salir}
              className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-border-glow)] hover:text-[var(--color-ink)]"
            >
              <LogOut size={13} /> {t('signOut')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setModo(modo === 'claim' ? null : 'claim');
                  setError(null);
                }}
                className="rounded-md bg-[var(--color-neon)] px-3 py-1.5 text-xs font-semibold text-[var(--color-void)] transition-opacity hover:opacity-90"
              >
                {t('claim')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setModo(modo === 'login' ? null : 'login');
                  setError(null);
                }}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-border-glow)] hover:text-[var(--color-ink)]"
              >
                {t('signIn')}
              </button>
            </>
          )}
        </div>
      </div>

      {modo && (
        <form
          action={enviar}
          className="mt-4 flex flex-col gap-3 border-t border-[var(--color-border)] pt-4"
        >
          <p className="text-xs text-[var(--color-ink-dim)]">{t(`intro.${modo}`)}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label={t('email')} name="email" type="email" autoComplete="email" />
            <Campo
              label={t('password')}
              name="password"
              type="password"
              autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
              hint={modo === 'login' ? undefined : t('passwordHint')}
            />
            {modo === 'recover' && (
              <Campo label={t('code')} name="code" type="text" autoComplete="off" />
            )}
          </div>

          {error && (
            <p role="alert" className="text-xs text-[var(--color-damage)]">
              {t(`errors.${error}`)}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={enviando}
              className="rounded-md bg-[var(--color-neon)] px-4 py-1.5 text-xs font-semibold text-[var(--color-void)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t(`submit.${modo}`)}
            </button>

            {modo === 'login' && (
              <button
                type="button"
                onClick={() => {
                  setModo('recover');
                  setError(null);
                }}
                className="text-xs text-[var(--color-ink-faint)] underline underline-offset-2 hover:text-[var(--color-ink-dim)]"
              >
                {t('forgot')}
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

/**
 * Campo con etiqueta y pista.
 *
 * La pista va **fuera** de la etiqueta, referenciada con `aria-describedby`.
 * Dentro pasaría a formar parte del nombre accesible del campo, que quedaría
 * como «Contraseña Mínimo 10 caracteres»: un lector de pantalla anunciaría la
 * frase entera cada vez que se entra al campo, y buscarlo por su nombre deja
 * de funcionar. Es la diferencia entre nombrar algo y describirlo.
 */
function Campo({
  label,
  hint,
  name,
  ...props
}: { label: string; hint?: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-xs text-[var(--color-ink-dim)]">
        {label}
      </label>
      <input
        required
        id={name}
        name={name}
        aria-describedby={hint ? `${name}-hint` : undefined}
        {...props}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-abyss)] px-3 py-2 font-mono text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-neon)]"
      />
      {hint && (
        <span id={`${name}-hint`} className="text-[10px] text-[var(--color-ink-faint)]">
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * El código de recuperación, una sola vez.
 *
 * Ocupa la tarjeta entera y pide una confirmación explícita porque es
 * irrepetible: solo se guarda su hash, así que cerrarlo sin copiarlo es
 * perderlo. Enseñarlo como un aviso más, entre otras cosas, sería garantizar
 * que nadie lo apunta.
 */
function RecoveryCode({ code, onDone }: { code: string; onDone: () => void }) {
  const t = useTranslations('account');
  const [copiado, setCopiado] = useState(false);
  const [confirmado, setConfirmado] = useState(false);

  return (
    <section className="rounded-[var(--radius-panel)] border border-[var(--color-power)] bg-[var(--color-panel)] p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
        <KeyRound size={15} className="text-[var(--color-power)]" /> {t('recoveryTitle')}
      </p>
      <p className="mt-2 max-w-lg text-xs leading-relaxed text-[var(--color-ink-dim)]">
        {t('recoveryHint')}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <code
          data-testid="recovery-code"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-abyss)] px-4 py-2 font-mono text-lg tracking-widest text-[var(--color-ink)]"
        >
          {code}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(code);
            setCopiado(true);
          }}
          className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
        >
          {copiado ? <Check size={13} /> : <Copy size={13} />}
          {copiado ? t('copied') : t('copy')}
        </button>
      </div>

      <label className="mt-4 flex items-center gap-2 text-xs text-[var(--color-ink-dim)]">
        <input
          type="checkbox"
          checked={confirmado}
          onChange={(event) => setConfirmado(event.target.checked)}
        />
        {t('recoverySaved')}
      </label>

      <button
        type="button"
        disabled={!confirmado}
        onClick={onDone}
        className="mt-3 rounded-md bg-[var(--color-neon)] px-4 py-1.5 text-xs font-semibold text-[var(--color-void)] disabled:opacity-40"
      >
        {t('continue')}
      </button>
    </section>
  );
}
