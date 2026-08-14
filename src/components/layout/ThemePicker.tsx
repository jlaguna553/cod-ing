'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Palette } from 'lucide-react';
import { THEMES, useLayoutStore, type ThemeId } from '@/stores/useLayoutStore';

/**
 * Selector de paleta.
 *
 * El tema es un atributo en `<html>` y `globals.css` hace el resto: cada
 * paleta redefine las mismas variables CSS, así que ningún componente sabe que
 * esto existe.
 *
 * Va aparte de la disposición aunque compartan store: «Restablecer» devuelve
 * las tarjetas a su sitio y **no** cambia la paleta. Son dos preferencias
 * distintas y mezclarlas sorprende — quien recoloca su pantalla no espera que
 * también le cambien los colores.
 */
export function ThemePicker() {
  const t = useTranslations();
  const theme = useLayoutStore((s) => s.theme);
  const setTheme = useLayoutStore((s) => s.setTheme);

  /*
   * Se sincroniza el atributo con lo persistido.
   *
   * El script del `<head>` ya lo aplicó antes del primer pintado; esto cubre
   * los cambios posteriores y el caso de que la hidratación traiga otro valor.
   */
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-dim)]">
      <Palette size={13} aria-hidden />
      <span className="sr-only">{t('theme.label')}</span>
      <select
        aria-label={t('theme.label')}
        value={theme}
        onChange={(event) => setTheme(event.target.value as ThemeId)}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1 text-xs text-[var(--color-ink)] transition-colors hover:border-[var(--color-border-glow)]"
      >
        {THEMES.map((id) => (
          <option key={id} value={id}>
            {t(`theme.names.${id}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
