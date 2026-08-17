import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Esquema de progreso.
 *
 * Postgres a través de Drizzle. En desarrollo y tests corre sobre **PGlite**
 * (Postgres compilado a WASM): mismo SQL, mismo schema, sin servidor que
 * levantar. En producción el mismo archivo apunta a un Postgres real — solo
 * cambia el driver en `client.ts`.
 */

/**
 * Usuario.
 *
 * `email` es opcional a propósito: la plataforma arranca con **identidad
 * anónima**. Pedir registro antes de dejar escribir una línea de código es la
 * forma más eficaz de perder al usuario en la primera pantalla. La cuenta se
 * reclama después, y entonces el `id` anónimo se conserva junto al progreso.
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email'),
    /** scrypt con sus parámetros dentro. Null mientras la cuenta sea anónima. */
    passwordHash: text('password_hash'),
    /**
     * Hash del código de recuperación.
     *
     * Es la **única** vía de reset: no se envía correo a nadie, así que sin
     * este código una contraseña olvidada es una cuenta perdida. Se guarda
     * hasheado por el mismo motivo que la contraseña — quien lea la base no
     * debe poder entrar con lo que lee.
     */
    recoveryHash: text('recovery_hash'),
    displayName: text('display_name'),
    /**
     * Zona horaria declarada por el navegador (IANA), para que la racha corte
     * a la medianoche del usuario y no a la de Londres.
     */
    timeZone: text('time_zone'),
    locale: text('locale').notNull().default('es'),
    /** true mientras no haya reclamado la cuenta con un email. */
    anonymous: boolean('anonymous').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)],
);

/**
 * Estadísticas agregadas.
 *
 * Se guardan denormalizadas en lugar de recalcularse desde `lesson_progress`
 * en cada carga: el HUD las pide en cada pantalla, y un `COUNT` sobre el
 * historial completo para pintar una barra de XP es trabajo desperdiciado.
 * La fuente de verdad para conceder XP sigue siendo el servidor.
 */
export const userStats = pgTable('user_stats', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  totalXp: integer('total_xp').notNull().default(0),
  level: integer('level').notNull().default(1),
  totalKeystrokes: integer('total_keystrokes').notNull().default(0),
  bestCombo: integer('best_combo').notNull().default(0),
  flawlessStreak: integer('flawless_streak').notNull().default(0),
  noHintLessons: integer('no_hint_lessons').notNull().default(0),
  fastestClearSeconds: integer('fastest_clear_seconds'),
  /** Racha de días consecutivos con actividad. */
  streakDays: integer('streak_days').notNull().default(0),
  /** Día (UTC, YYYY-MM-DD) de la última actividad, para calcular la racha. */
  lastActiveDay: text('last_active_day'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const lessonProgress = pgTable(
  'lesson_progress',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lessonId: text('lesson_id').notNull(),
    track: text('track').notNull(),
    module: text('module').notNull(),
    status: text('status', { enum: ['in-progress', 'completed'] })
      .notNull()
      .default('in-progress'),
    stepIndex: integer('step_index').notNull().default(0),
    xpEarned: integer('xp_earned').notNull().default(0),
    hintsUsed: integer('hints_used').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    damageTaken: integer('damage_taken').notNull().default(0),
    bestTimeMs: integer('best_time_ms'),
    /**
     * Buffer del usuario. Permite reanudar exactamente donde lo dejó, incluso
     * tras cambiar de idioma o de dispositivo — el motivo por el que el
     * progreso se indexa por `lessonId` y no por ruta localizada (ADR-01).
     */
    codeSnapshot: jsonb('code_snapshot').$type<Record<string, string>>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.lessonId] }),
    index('lesson_progress_user_idx').on(table.userId),
    index('lesson_progress_track_idx').on(table.userId, table.track),
  ],
);

export const userAchievements = pgTable(
  'user_achievements',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    achievementId: text('achievement_id').notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.achievementId] })],
);

/**
 * Eventos de observabilidad.
 *
 * Es la única tabla que **no** es progreso: sirve para saber qué se rompe y
 * dónde se atasca la gente, no para jugar. Por eso su `user_id` no tiene clave
 * foránea — un evento sobrevive a que la cuenta anónima que lo generó se funda
 * con otra o desaparezca, y perder la traza justo cuando alguien reclama su
 * cuenta sería perderla en el momento más interesante.
 *
 * Lo que se guarda está acotado en el servidor: un tipo de una lista cerrada y
 * un `payload` recortado. **Nunca el código del usuario**: puede contener
 * cualquier cosa que haya tecleado, y para contar cuántos fallan un paso no
 * hace falta.
 */
export const events = pgTable(
  'events',
  {
    id: serial('id').primaryKey(),
    kind: text('kind').notNull(),
    /** Identidad anónima o reclamada. Sin FK: ver la nota de arriba. */
    userId: text('user_id'),
    lessonId: text('lesson_id'),
    stepIndex: integer('step_index'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('events_kind_idx').on(table.kind, table.createdAt),
    index('events_lesson_idx').on(table.lessonId, table.stepIndex),
  ],
);

export type Event = typeof events.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserStats = typeof userStats.$inferSelect;
export type LessonProgress = typeof lessonProgress.$inferSelect;
export type UserAchievement = typeof userAchievements.$inferSelect;
