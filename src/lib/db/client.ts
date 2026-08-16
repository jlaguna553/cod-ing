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

/**
 * La instancia vive en `globalThis`, no en el módulo.
 *
 * Next compila las páginas y las rutas de API en **capas distintas**, y un
 * módulo importado desde las dos se instancia una vez por capa aunque el
 * proceso sea el mismo. Con un `let` de módulo había, por tanto, dos clientes.
 *
 * Con Postgres eso solo significa una conexión de más. Con PGlite en memoria
 * significa **dos bases distintas**, y el síntoma es de los que cuesta creer:
 * `POST /api/progress/complete` concedía 185 XP, respondía 200, y la portada
 * renderizada en el servidor seguía enseñando 0 lecciones y 0 XP. Cada una
 * miraba su propia base vacía. Es el modo en que se desarrolla sin Postgres
 * delante, así que no era un problema solo de los tests.
 */
const CLAVE = Symbol.for('codequest.db');
const global = globalThis as { [CLAVE]?: { instance: Database | null; ready: Promise<Database> | null } };
const cache = (global[CLAVE] ??= { instance: null, ready: null });

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
  password_hash TEXT,
  recovery_hash TEXT,
  display_name TEXT,
  locale TEXT NOT NULL DEFAULT 'es',
  anonymous BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- Para las bases que ya existían: CREATE TABLE IF NOT EXISTS no añade columnas
-- a una tabla creada antes, así que las nuevas se declaran también aquí.
-- IF NOT EXISTS las hace idempotentes y sin efecto donde ya están.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_hash TEXT;

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

CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  user_id     TEXT,
  lesson_id   TEXT,
  step_index  INTEGER,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS events_kind_idx ON events (kind, created_at);
CREATE INDEX IF NOT EXISTS events_lesson_idx ON events (lesson_id, step_index);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, achievement_id)
);
`;

/**
 * Cadena de conexión.
 *
 * Se aceptan varios nombres porque las integraciones del Marketplace de Vercel
 * no siempre inyectan `DATABASE_URL`: Neon usa ese, pero otras ponen
 * `POSTGRES_URL`. Buscar los dos evita el fallo más tonto posible —tener la
 * base creada y conectada, y que la aplicación no la vea.
 */
export function databaseUrl(): string | undefined {
  for (const candidate of [process.env.DATABASE_URL, process.env.POSTGRES_URL]) {
    /*
     * Se descarta lo que no sea una cadena de Postgres.
     *
     * `vercel env pull` escribe el literal `[SENSITIVE]` para las variables de
     * sus integraciones, y ese archivo acaba en el `.env.local` de cualquiera
     * que haya intentado descargarlas. Sin este filtro, el servidor de
     * desarrollo intenta conectar a `[SENSITIVE]` y revienta con un
     * `TypeError: Invalid URL` que no dice nada de dónde viene.
     */
    if (candidate && /^postgres(ql)?:\/\//.test(candidate)) return candidate;
  }
  return undefined;
}

async function create(): Promise<Database> {
  const url = databaseUrl();

  if (url) {
    const { default: postgres } = await import('postgres');

    /*
     * `max: 1` y `prepare: false` no son arbitrarios: en un entorno serverless
     * cada invocación puede crear su propia conexión, y un pool grande agota
     * los slots del servidor en cuanto hay algo de tráfico. Los prepared
     * statements tampoco sobreviven a un pooler en modo transacción.
     */
    const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 20 });

    /*
     * El esquema se aplica solo, la primera vez que el proceso se conecta.
     *
     * La alternativa —migrar a mano desde el portátil— resulta imposible con
     * las integraciones del Marketplace de Vercel: marcan sus variables como
     * «Sensitive» y `vercel env pull` devuelve el literal `[SENSITIVE]` en
     * lugar de la cadena. La credencial solo existe dentro del servidor, así
     * que es el servidor quien tiene que crear las tablas.
     *
     * Es seguro porque el DDL es idempotente (`CREATE TABLE IF NOT EXISTS`) y
     * cuesta milisegundos cuando ya están creadas. El `catch` cubre la carrera
     * de dos instancias arrancando a la vez: si otra se adelantó, las tablas
     * ya existen y seguir es lo correcto.
     *
     * ⚠️ Esto vale para un esquema inicial. En cuanto haya migraciones que
     * modifiquen datos existentes, hará falta historia de versiones y un paso
     * explícito — no un DDL que se ejecuta solo en cada arranque en frío.
     */
    try {
      await sql.unsafe(DDL);
    } catch (cause) {
      console.warn(
        '[db] no se pudo aplicar el esquema automáticamente:',
        cause instanceof Error ? cause.message : cause,
      );
    }

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
  if (cache.instance) return cache.instance;
  cache.ready ??= create().then((db) => {
    cache.instance = db;
    return db;
  });
  return cache.ready;
}

/** Solo para tests: base limpia en memoria. */
export async function createTestDb(): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  await pg.exec(DDL);
  return drizzlePglite(pg, { schema });
}

export { schema };
