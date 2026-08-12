/**
 * Falla si los diccionarios de UI divergen entre idiomas.
 *
 * El contenido de las lecciones ya lo garantiza Zod (`LocalizedText` exige
 * ambos idiomas). Esto cubre el otro lado: `messages/*.json`, donde no hay
 * schema que obligue a nada. Sin este check, una clave añadida solo en `es`
 * se descubre en producción como texto crudo tipo `nav.language`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LOCALES } from '../src/lib/content/lesson.schema';

const MESSAGES_DIR = path.resolve(import.meta.dirname, '../messages');

type Json = { [key: string]: string | Json };

function flatten(obj: Json, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'object' && value !== null ? flatten(value, full) : [full];
  });
}

/** Extrae los placeholders ICU: `{count}`, `{level}`… */
function placeholders(value: string): Set<string> {
  return new Set([...value.matchAll(/\{(\w+)/g)].map((m) => m[1]));
}

function valueAt(obj: Json, key: string): string | undefined {
  const found = key.split('.').reduce<unknown>((acc, part) => {
    if (typeof acc === 'object' && acc !== null) return (acc as Json)[part];
    return undefined;
  }, obj);
  return typeof found === 'string' ? found : undefined;
}

const dicts = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    JSON.parse(readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), 'utf8')) as Json,
  ]),
);

const [reference, ...others] = LOCALES;
const referenceKeys = flatten(dicts[reference]);
let failed = 0;

for (const locale of others) {
  const keys = new Set(flatten(dicts[locale]));

  for (const key of referenceKeys) {
    if (!keys.has(key)) {
      console.error(`✖ ${locale}: falta la clave "${key}" (presente en ${reference})`);
      failed++;
      continue;
    }
    // Un placeholder distinto entre idiomas revienta en runtime al formatear.
    const a = placeholders(valueAt(dicts[reference], key) ?? '');
    const b = placeholders(valueAt(dicts[locale], key) ?? '');
    const mismatched = [...a].filter((p) => !b.has(p)).concat([...b].filter((p) => !a.has(p)));
    if (mismatched.length > 0) {
      console.error(`✖ ${locale}: placeholders distintos en "${key}" → ${mismatched.join(', ')}`);
      failed++;
    }
  }

  for (const key of keys) {
    if (!referenceKeys.includes(key)) {
      console.error(`✖ ${locale}: clave sobrante "${key}" (no existe en ${reference})`);
      failed++;
    }
  }
}

console.log(
  failed === 0
    ? `✔ i18n en paridad · ${referenceKeys.length} claves × ${LOCALES.length} idiomas`
    : `\n${failed} problemas de paridad i18n`,
);
if (failed > 0) process.exit(1);
