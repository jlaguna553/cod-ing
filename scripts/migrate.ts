/**
 * Aplica el esquema a la base de datos de `DATABASE_URL`.
 *
 * En desarrollo PGlite ejecuta el DDL al arrancar, pero un Postgres real no se
 * toca solo: hay que aplicarlo una vez antes del primer despliegue.
 *
 *   DATABASE_URL='postgres://…' npm run db:migrate
 */
import postgres from 'postgres';
import { DDL } from '../src/lib/db/client';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✖ Falta DATABASE_URL.');
    console.error('  Uso: DATABASE_URL=postgres://… npm run db:migrate');
    process.exit(1);
  }

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
