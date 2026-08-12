import 'server-only';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

/**
 * Cliente de base de datos.
 *
 * Un solo schema, dos drivers:
 *
 * - **Postgres real** cuando hay `DATABASE_URL`. Es lo que corre en producción.
 * - **PGlite** (Postgres compilado a WASM) cuando no la hay. Es Postgres de
 *   verdad, no un sustituto: mismo SQL, mismas restricciones, mismos tipos.
 *   Permite desarrollar y **probar la capa de datos** sin levantar un servidor.
 *
 * Al no divergir el schema, lo que pasa en test es lo que pasa en producción.
 */

// El tipo se toma del driver de PGlite: ambos exponen la misma API de Drizzle
// para las consultas que usa la aplicación.
export type Database = ReturnType<typeof drizzlePglite<typeof schema>>;

let instance: Database | null = null;
let ready: Promise<Database> | null = null;

/**
 * DDL en crudo.
 *
 * Con una sola migración inicial no compensa `drizzle-kit`. En cuanto haya una
 * segunda, esto pasa a ser una migración numerada y `db:migrate` las aplica en
 * orden — cambiar el esquema en caliente sobre datos reales necesita historia,
 * no un `CREATE TABLE IF NOT EXISTS`.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  locale TEXT NOT NULL DEFAULT 'es',
  anonymous BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);

CREATE TABLE IF NOT EXISTS user_stats (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  total_keystrokes INTEGER NOT NULL DEFAULT 0,
  best_combo INTEGER NOT NULL DEFAULT 0,
  flawless_streak INTEGER NOT NULL DEFAULT 0,
  no_hint_lessons INTEGER NOT NULL DEFAULT 0,
  fastest_clear_seconds INTEGER,
  streak_days INTEGER NOT NULL DEFAULT 0,
  last_active_day TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL,
  track TEXT NOT NULL,
  module TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in-progress',
  step_index INTEGER NOT NULL DEFAULT 0,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  hints_used INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  damage_taken INTEGER NOT NULL DEFAULT 0,
  best_time_ms INTEGER,
  code_snapshot JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS lesson_progress_user_idx ON lesson_progress (user_id);
CREATE INDEX IF NOT EXISTS lesson_progress_track_idx ON lesson_progress (user_id, track);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, achievement_id)
);
`;

async function create(): Promise<Database> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const { default: postgres } = await import('postgres');

    /*
     * `max: 1` y `prepare: false` no son arbitrarios: en un entorno serverless
     * cada invocación puede crear su propia conexión, y un pool grande agota
     * los slots del servidor en cuanto hay algo de tráfico. Los prepared
     * statements tampoco sobreviven a un pooler en modo transacción.
     */
    const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 20 });
    return drizzlePostgres(sql, { schema }) as unknown as Database;
  }

  /*
   * Sin `DATABASE_URL` en producción se falla en vez de arrancar.
   *
   * PGlite guardaría el progreso en la memoria de la instancia y lo perdería
   * en cada arranque en frío: la aplicación *parecería* funcionar mientras
   * borra los datos de los usuarios en silencio. Un fallo ruidoso es mejor.
   *
   * `ALLOW_PGLITE_IN_PRODUCTION` es la única salida, y tiene ese nombre tan
   * largo a propósito: nadie la escribe por accidente. La usan los tests E2E,
   * que corren contra un build de producción y no tienen Postgres delante.
   */
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_PGLITE_IN_PRODUCTION) {
    throw new Error(
      'DATABASE_URL es obligatoria en producción. Sin ella el progreso se ' +
        'perdería en cada arranque en frío. Ver docs/DEPLOY.md.',
    );
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite(process.env.PGLITE_DATA_DIR);
  await pg.exec(DDL);

  return drizzlePglite(pg, { schema });
}

/** Instancia única, creada de forma perezosa y compartida por el proceso. */
export async function getDb(): Promise<Database> {
  if (instance) return instance;
  ready ??= create().then((db) => {
    instance = db;
    return db;
  });
  return ready;
}

/** Solo para tests: base limpia en memoria. */
export async function createTestDb(): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  await pg.exec(DDL);
  return drizzlePglite(pg, { schema });
}

export { schema };
