import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { routing } from '@/i18n/routing';
import { PerformanceModeBoot } from '@/components/system/PerformanceModeBoot';
import '../globals.css';

type LocaleParams = { params: Promise<{ locale: string }> };

/** Prerenderiza ambos idiomas en build: /es y /en son estáticos. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return {
    title: { default: t('appName'), template: `%s · ${t('appName')}` },
    description: t('tagline'),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleParams & { children: React.ReactNode }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Sin esto, cualquier uso de `useTranslations` fuerza render dinámico.
  setRequestLocale(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/*
          El tema se aplica ANTES del primer pintado.

          Leerlo desde React llegaría tarde: el navegador ya habría pintado con
          la paleta por defecto y se vería un destello azul antes de cambiar a
          la elegida, en cada carga. Este script es diminuto, síncrono y lo
          único que hace es copiar un valor de `localStorage` a un atributo —
          que es exactamente lo que `globals.css` necesita para decidir colores.

          Va envuelto en try/catch porque `localStorage` lanza en modo privado
          de algunos navegadores, y quedarse sin tema es mucho mejor que
          quedarse sin página.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var s=localStorage.getItem('codequest.layout');" +
              "var t=s&&JSON.parse(s).state&&JSON.parse(s).state.theme;" +
              "if(t)document.documentElement.dataset.theme=t;}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-dvh antialiased">
        <PerformanceModeBoot />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
