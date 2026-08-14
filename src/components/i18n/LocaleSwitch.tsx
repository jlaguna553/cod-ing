'use client';

import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Languages } from 'lucide-react';
import { routing } from '@/i18n/routing';
import { usePathname, useRouter } from '@/i18n/navigation';

/**
 * Cambia de idioma conservando la ruta actual.
 *
 * `usePathname` de `@/i18n/navigation` devuelve la ruta SIN el prefijo de
 * locale, y `router.replace({pathname, params}, {locale})` la reconstruye en
 * el idioma destino. Por eso `/es/play/devops/docker-07-layer-cache` aterriza
 * en `/en/play/devops/docker-07-layer-cache` y no en la home.
 *
 * `replace` (no `push`) evita llenar el historial de saltos de idioma.
 *
 * `compact` quita la etiqueta y deja solo los dos botones: en la barra superior
 * de la pantalla de juego el espacio es horizontal y «ES / EN» ya se explica
 * solo. El grupo conserva su `aria-label`, que es lo que de verdad lo nombra.
 */
export function LocaleSwitch({ compact = false }: { compact?: boolean } = {}) {
  const t = useTranslations();
  const active = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();

  return (
    <div className={compact ? 'flex items-center' : 'flex flex-col gap-2'}>
      {!compact && (
        <span className="flex items-center gap-2 text-xs uppercase tracking-widest text-[var(--color-ink-faint)]">
          <Languages size={13} />
          {t('nav.language')}
        </span>
      )}

      <div
        role="radiogroup"
        aria-label={t('nav.language')}
        className="flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-abyss)] p-1"
      >
        {routing.locales.map((locale) => {
          const isActive = locale === active;
          return (
            <button
              key={locale}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={t('nav.switchTo', { locale: t(`locale.${locale}`) })}
              onClick={() =>
                router.replace(
                  // @ts-expect-error — params tipados por ruta; genéricos aquí.
                  { pathname, params },
                  { locale },
                )
              }
              className={
                'flex-1 rounded-md text-xs font-semibold uppercase transition-colors ' +
                (compact ? 'px-2 py-1 ' : 'px-3 py-1.5 ') +
                (isActive
                  ? 'bg-[var(--color-neon)] text-[var(--color-void)]'
                  : 'text-[var(--color-ink-dim)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]')
              }
            >
              {locale}
            </button>
          );
        })}
      </div>
    </div>
  );
}
