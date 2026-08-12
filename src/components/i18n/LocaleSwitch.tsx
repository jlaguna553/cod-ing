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
 */
export function LocaleSwitch() {
  const t = useTranslations();
  const active = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();

  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-2 text-xs uppercase tracking-widest text-[var(--color-ink-faint)]">
        <Languages size={13} />
        {t('nav.language')}
      </span>

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
                'flex-1 rounded-md px-3 py-1.5 text-xs font-semibold uppercase transition-colors ' +
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
