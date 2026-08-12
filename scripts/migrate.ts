/**
 * Aplica el esquema a la base de datos de `DATABASE_URL`.
 *
 * En desarrollo PGlite ejecuta el DDL al arrancar, pero un Postgres real no se
 * toca solo: hay que aplicarlo una vez antes del primer despliegue.
 *
 *   DATABASE_URL='postgres://…' npm run db:migrate
 */
import { existsSync, readFileSync } from 'node:fs';
import postgres from 'postgres';
import { DDL } from '../src/lib/db/client';

/**
 * Carga variables de un archivo `.env*` si no están ya en el entorno.
 *
 * `vercel env pull` deja las credenciales en `.env.local`, y sin esto habría
 * que copiar la cadena a mano desde ese archivo a la línea de comandos — un
 * paso extra que solo sirve para equivocarse al pegar.
 */
function loadEnvFile(file: string) {
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key]) continue;

    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '');
  }
}

async function main() {
  loadEnvFile('.env.local');
  loadEnvFile('.env');

  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    console.error('✖ No encuentro la cadena de conexión.');
    console.error('');
    console.error('  Si la base está en Vercel, descarga las variables de');
    console.error('  PRODUCCIÓN — `vercel env pull` sin más baja las de');
    console.error('  desarrollo, donde DATABASE_URL no existe:');
    console.error('');
    console.error('    vercel env pull .env.local --environment=production');
    console.error('    npm run db:migrate');
    console.error('');
    console.error('  Para ver qué variables hay y en qué entorno:');
    console.error('    vercel env ls');
    console.error('');
    console.error('  O pasa la cadena directamente:');
    console.error('    DATABASE_URL=postgres://… npm run db:migrate');

    // Pista concreta: si el archivo existe pero no trae la variable, el
    // problema es el entorno equivocado, no que falte el `pull`.
    if (existsSync('.env.local')) {
      const keys = readFileSync('.env.local', 'utf8')
        .split('\n')
        .map((line) => line.split('=')[0].trim())
        .filter((key) => /^[A-Z_][A-Z0-9_]*$/i.test(key));
      console.error('');
      console.error(`  (.env.local existe y contiene: ${keys.join(', ') || 'nada'})`);
    }

    process.exit(1);
  }

  /*
   * Vercel marca como «Sensitive» las variables que crean sus integraciones, y
   * `vercel env pull` NO descarga su valor: escribe el literal `[SENSITIVE]`.
   * El pull parece funcionar y el archivo se actualiza, pero lo que llega no
   * sirve. Sin esta comprobación, el fallo era un `TypeError: Invalid URL` con
   * un stack de `postgres/src/index.js` que no apunta a nada útil.
   */
  if (url.includes('[SENSITIVE]') || !/^postgres(ql)?:\/\//.test(url)) {
    console.error('✖ La cadena de conexión no es válida.');
    console.error('');
    if (url.includes('[SENSITIVE]')) {
      console.error('  Vale `[SENSITIVE]`: Vercel oculta el valor de las variables que');
      console.error('  crean sus integraciones y `vercel env pull` no lo descarga.');
      console.error('');
      console.error('  Cópiala del panel y pásala directamente:');
      console.error('    Vercel → Storage → tu base → Connect → connection string');
      console.error('');
      console.error("    DATABASE_URL='postgresql://…' npm run db:migrate");
    } else {
      console.error(`  Empieza por: ${url.slice(0, 12)}…`);
      console.error('  Debe empezar por postgres:// o postgresql://');
    }
    process.exit(1);
  }

  const host = url.replace(/\/\/[^@]*@/, '//***@').split('/')[2] ?? '';
  console.log(`Conectando a ${host}…`);

  /*
   * `max: 1` porque es un script de un solo uso; no hace falta pool.
   *
   * `prepare: false` para que funcione también a través de un pooler en modo
   * transacción (el de Supabase en el puerto 6543, por ejemplo), que no
   * soporta prepared statements. Con una conexión directa no estorba.
   */
  const sql = postgres(url, { max: 1, prepare: false });

  try {
    await sql.unsafe(DDL);
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;

    console.log('✔ Esquema aplicado. Tablas:');
    for (const row of tables) console.log(`    ${row.table_name}`);
  } catch (cause) {
    console.error('✖ No se pudo aplicar el esquema:');
    console.error(cause instanceof Error ? cause.message : cause);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

void main();
