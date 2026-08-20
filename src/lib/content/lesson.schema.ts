/**
 * FUENTE DE VERDAD del modelo de contenido.
 *
 * De aquí se derivan:
 *   - los tipos TypeScript      (`types.ts`, vía z.infer)
 *   - el JSON Schema publicado  (`scripts/generate-json-schema.ts`)
 *   - la validación en CI       (`scripts/validate-content.ts`)
 *
 * Nunca edites `content/schema/lesson.schema.json` a mano: se regenera.
 */
import { z } from 'zod';

/* ─────────────────────────────  i18n  ───────────────────────────── */

export const LOCALES = ['es', 'en'] as const;
export const LocaleSchema = z.enum(LOCALES);

/**
 * Texto bilingüe obligatorio en AMBOS idiomas (ADR-01).
 * Que `en` no sea opcional es deliberado: hace imposible mergear
 * una lección a medio traducir. Es la única garantía que escala.
 */
export const LocalizedTextSchema = z.object({
  es: z.string().min(1),
  en: z.string().min(1),
});

/** Markdown bilingüe (soporta ```code```, listas, **negrita**). */
export const LocalizedMarkdownSchema = LocalizedTextSchema;

/* ─────────────────────────  Taxonomía  ──────────────────────────── */

export const TrackSchema = z.enum(['frontend', 'backend', 'devops']);

/** Progresión RPG. `interview` es el "boss" de cada módulo. */
export const DifficultySchema = z.enum([
  'novice',     // primer contacto con el concepto
  'apprentice', // aplicación guiada
  'adept',      // aplicación autónoma
  'expert',     // optimización y edge cases
  'interview',  // problema real de entrevista técnica
]);

export const LessonKindSchema = z.enum([
  'concept',       // explicación + una construcción guiada
  'drill',         // 3-4 variaciones cortas → memoria muscular
  'challenge',     // problema abierto con tests
  'interview',     // LeetCode-style / troubleshooting real
  'system-design', // diseño arquitectónico, evaluado por rúbrica
]);

/* ────────────────────────  Runtime / Runner  ────────────────────── */

export const RuntimeKindSchema = z.enum([
  'dom',          // iframe sandbox: HTML/CSS/JS puro
  'sandpack',     // bundler in-browser: React/Vue/TS
  'webcontainer', // Node.js + bash reales en WASM
  'pyodide',      // Python en WASM
  'remote',       // Piston/Judge0 vía /api/run: Go, SQL, Java...
  'cli-sim',      // simulador determinista: docker, kubectl, git (ADR-03)
  'sql',          // Postgres de verdad en el navegador, vía PGlite (ADR-11)
  'vue',          // Vue 3 sin bundler ni terceros, autoalojado (ADR-13)
  'php',          // PHP interpretado en JavaScript, autoalojado (ADR-20)
  'ts',           // TypeScript: tipos con el compilador del editor (ADR-25)
  'node',         // Node simulado: módulos, fs, http deterministas (ADR-26)
  'nest',         // NestJS reducido a su contrato, sobre el de Node (ADR-28)
]);

/**
 * Terminal interactiva (ADR-07). Cuando está activa, el usuario teclea los
 * comandos él mismo: instalar Vite es parte de la lección, no andamiaje.
 */
export const TerminalSpecSchema = z.object({
  enabled: z.boolean().default(false),
  /**
   * Barandilla pedagógica, no de seguridad — el contenedor ya está aislado.
   * Vacío = sin restricción. Se comparan por prefijo: "npm " permite
   * cualquier subcomando de npm.
   */
  allowedCommands: z.array(z.string()).default([]),
  /** Texto de bienvenida al abrir la terminal. */
  greeting: LocalizedTextSchema.optional(),
});

export const RuntimeSpecSchema = z.object({
  kind: RuntimeKindSchema,
  /** Comando de arranque. Ej: "npm run dev", "python main.py", "docker build ." */
  command: z.string().optional(),
  terminal: TerminalSpecSchema.prefault({}),
  /** Dependencias npm/pip a preinstalar. */
  dependencies: z.record(z.string(), z.string()).default({}),
  /** Puerto a exponer en el preview (webcontainer con servidor HTTP). */
  previewPort: z.number().int().positive().optional(),
  /** Solo `remote`: lenguaje del runner externo. */
  language: z.string().optional(),
  /** Solo `cli-sim`: guion de comandos reconocidos y sus salidas. */
  cliScenario: z.string().optional(),
  /**
   * Solo `node`: peticiones que se lanzan contra el servidor al llamar a
   * `listen`.
   *
   * Aquí no hay red ni navegador que visite una URL, así que un servidor sin
   * esto sería un `createServer` que no se ejecuta jamás y una lección sin
   * salida que comprobar. Declararlas en la lección las hace además
   * deterministas: mismas peticiones, mismo orden, misma salida.
   */
  requests: z
    .array(
      z.object({
        method: z.string().default('GET'),
        url: z.string(),
        /** Cuerpo JSON de la petición, para lo que llega por `@Body()`. */
        body: z.string().optional(),
      }),
    )
    .default([]),
  timeoutMs: z.number().int().positive().default(10_000),
});

/* ──────────────────────────  Workspace  ─────────────────────────── */

export const WorkspaceFileSchema = z.object({
  path: z.string().min(1),
  /** Contenido inicial. Soporta marcadores `/* TODO:key *\/` sustituidos por i18n. */
  content: z.string(),
  /** Visible pero no editable (código de soporte, tests). */
  readOnly: z.boolean().default(false),
  /** Existe para el runner pero no se muestra en el árbol. */
  hidden: z.boolean().default(false),
  /** Abrir esta pestaña al cargar la lección. */
  active: z.boolean().default(false),
});

/**
 * Workspace del ejercicio (ADR-08).
 *
 * `files` es el estado INICIAL, no la lista definitiva: durante la sesión la
 * verdad del sistema de archivos la tiene el runner, porque el usuario crea
 * archivos y los comandos generan decenas de ellos.
 */
export const WorkspaceSchema = z.object({
  files: z.array(WorkspaceFileSchema).min(1),
  entry: z.string().min(1),
  /** Permite crear archivos y carpetas desde el árbol. */
  allowCreate: z.boolean().default(false),
  /** Permite borrar y renombrar. Independiente de `allowCreate`. */
  allowDelete: z.boolean().default(false),
  /**
   * Rutas que no se pueden borrar ni renombrar aunque `allowDelete` esté
   * activo: sostienen la evaluación. Prefijo de ruta o archivo exacto.
   */
  protectedPaths: z.array(z.string()).default([]),
});

/* ─────────────────────  Reglas de validación  ───────────────────── */

/** Cuándo se evalúa una regla. */
export const RulePhaseSchema = z.enum([
  'type',   // mientras escribe → feedback visual inmediato (daño)
  'run',    // al pulsar ▶ Ejecutar
  'submit', // al validar el paso
]);

export const RuleSeveritySchema = z.enum([
  'damage', // shake rojo + resta energía, no bloquea
  'error',  // bloquea el avance del paso
  'warn',   // aviso de buenas prácticas, informativo
]);

const RuleBase = {
  id: z.string().min(1),
  phase: RulePhaseSchema.default('submit'),
  severity: RuleSeveritySchema.default('error'),
  /** Mensaje mostrado al fallar. Bilingüe obligatorio. */
  message: LocalizedTextSchema,
  /** Mensaje al pasar (opcional, para refuerzo positivo). */
  successMessage: LocalizedTextSchema.optional(),
  /** Puntos que aporta al score del paso. */
  points: z.number().int().nonnegative().default(10),
  /** Si es false, el usuario ve el criterio antes de resolver (tests visibles). */
  hidden: z.boolean().default(false),
};

/**
 * Unión discriminada por `kind`. Cada variante mapea 1:1 con un validador
 * en `src/lib/engine/validators/`. Añadir un tipo de assert = añadir una
 * variante aquí + su validador; nada más cambia.
 */
export const ValidationRuleSchema = z.discriminatedUnion('kind', [
  /* --- textuales: baratas, ideales para phase:"type" --- */
  z.object({
    ...RuleBase,
    kind: z.literal('regex-must'),
    file: z.string(),
    pattern: z.string(),
    flags: z.string().default('m'),
  }),
  z.object({
    ...RuleBase,
    kind: z.literal('regex-forbid'),
    file: z.string(),
    pattern: z.string(),
    flags: z.string().default('m'),
  }),

  /* --- estructurales: AST --- */
  z.object({
    ...RuleBase,
    kind: z.literal('ast-query'),
    file: z.string(),
    /**
     * Selector `esquery` sobre el AST (sintaxis tipo CSS para ESTree).
     * Ej: `CallExpression[callee.property.name="map"]`
     *
     * Se eligió sobre las queries de tree-sitter porque el track de frontend
     * es JS/JSX y `acorn` + `esquery` pesan una fracción de un WASM de
     * gramática. Cuando haya lecciones de Python o Go, tree-sitter volverá
     * como validador aparte para esos lenguajes.
     */
    query: z.string(),
    minMatches: z.number().int().nonnegative().default(1),
    maxMatches: z.number().int().nonnegative().optional(),
    /** Filtra los nodos encontrados por el valor de una de sus propiedades. */
    captureEquals: z.record(z.string(), z.string()).optional(),
  }),

  /* --- frontend: aserciones sobre el DOM renderizado --- */
  z.object({
    ...RuleBase,
    kind: z.literal('dom-assert'),
    selector: z.string(),
    assert: z.enum([
      'exists', 'notExists', 'textEquals', 'textContains',
      'attrEquals', 'styleEquals', 'countEquals',
    ]),
    attribute: z.string().optional(),
    expected: z.string().optional(),
    count: z.number().int().nonnegative().optional(),
  }),

  /* --- backend / scripting --- */
  z.object({
    ...RuleBase,
    kind: z.literal('stdout-match'),
    /** Coincidencia exacta (trim) o regex. */
    equals: z.string().optional(),
    matches: z.string().optional(),
    expectExitCode: z.number().int().default(0),
  }),
  /**
   * Resultado de una consulta SQL (ADR-11).
   *
   * Se comprueba el **conjunto de filas devuelto**, no el texto de la
   * consulta: hay muchas formas correctas de escribir el mismo `SELECT`, y
   * corregir por sintaxis penalizaría a quien resuelve bien de otra manera.
   * Para lo que sí es sintaxis —«usa un JOIN, no una subconsulta»— ya está
   * `regex-must`.
   */
  /**
   * Diagnóstico del compilador de TypeScript (ADR-25).
   *
   * Se comprueba el **error**, no el texto del código: media lección de tipos
   * consiste en provocar un fallo y leerlo, y otra media en que deje de
   * fallar. `expectCode` fija cuál —`2322` es «este tipo no encaja»— y
   * `expectNone` afirma lo contrario: que compila limpio.
   */
  z.object({
    ...RuleBase,
    kind: z.literal('type-error'),
    /** Código de TypeScript esperado, sin el prefijo `TS`. */
    expectCode: z.number().int().positive().optional(),
    /** Fragmento que debe aparecer en el mensaje. */
    messageContains: z.string().optional(),
    /** `true` = no debe haber ningún error de tipos. */
    expectNone: z.boolean().default(false),
  }),
  z.object({
    ...RuleBase,
    kind: z.literal('sql-result'),
    /** Filas esperadas, en JSON. Cada objeto es una fila por nombre de columna. */
    expectRows: z.array(z.record(z.string(), z.unknown())).optional(),
    /** Nombres de columna esperados, en orden. */
    expectColumns: z.array(z.string()).optional(),
    expectRowCount: z.number().int().nonnegative().optional(),
    /**
     * Si el orden de las filas importa. Por defecto NO: sin `ORDER BY`,
     * Postgres no garantiza ninguno y exigirlo sería exigir suerte.
     */
    ordered: z.boolean().default(false),
  }),
  z.object({
    ...RuleBase,
    kind: z.literal('unit-test'),
    /** Fichero de test (readOnly) ejecutado por el runner. */
    testFile: z.string(),
    framework: z.enum(['vitest', 'jest', 'pytest', 'go-test']),
    /** Nombre del caso; si se omite, deben pasar todos. */
    testName: z.string().optional(),
  }),
  z.object({
    ...RuleBase,
    kind: z.literal('http-assert'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
    path: z.string(),
    body: z.unknown().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    expectStatus: z.number().int().default(200),
    /** JSONPath → valor esperado, sobre el cuerpo de la respuesta. */
    expectJson: z.record(z.string(), z.unknown()).optional(),
  }),

  /* --- devops (ADR-03: validación estática + simulación) --- */
  z.object({
    ...RuleBase,
    kind: z.literal('file-exists'),
    file: z.string(),
  }),
  z.object({
    ...RuleBase,
    kind: z.literal('dockerfile-lint'),
    file: z.string().default('Dockerfile'),
    /** Reglas de buenas prácticas de la industria. */
    rules: z.array(z.enum([
      'multi-stage',          // usa build stages
      'cache-order',          // COPY manifests antes que COPY del código
      'non-root-user',        // USER != root
      'pinned-base-image',    // sin :latest
      'no-secrets',           // sin ENV/ARG con credenciales
      'minimal-layers',       // RUN encadenados
      'has-dockerignore',
      'healthcheck',
    ])).min(1),
  }),
  z.object({
    ...RuleBase,
    kind: z.literal('yaml-path'),
    file: z.string(),
    /** Ruta tipo `services.web.ports[0]` o `jobs.build.steps[1].uses`. */
    path: z.string(),
    equals: z.unknown().optional(),
    matches: z.string().optional(),
  }),
  z.object({
    ...RuleBase,
    kind: z.literal('cli-transcript'),
    /** Comandos que el usuario debe haber ejecutado, en orden. */
    expectedCommands: z.array(z.string()).min(1),
    /** Si true, se permiten comandos extra intercalados. */
    allowExtra: z.boolean().default(true),
  }),

  /* --- escape hatch: función registrada en el engine --- */
  z.object({
    ...RuleBase,
    kind: z.literal('custom'),
    /** Clave en el registry de validadores custom. */
    handler: z.string(),
    args: z.record(z.string(), z.unknown()).default({}),
  }),
]);

/* ────────────────────────  Pasos y drills  ──────────────────────── */

export const HintSchema = z.object({
  id: z.string(),
  /** Orden de revelado: primero pistas conceptuales, luego el código. */
  tier: z.number().int().min(1).max(3),
  text: LocalizedMarkdownSchema,
  /** XP descontado al revelarla. La ayuda tiene coste, pero existe. */
  xpPenalty: z.number().int().nonnegative().default(5),
  /** Auto-ofrecer tras N segundos atascado (0 = nunca). */
  autoOfferAfterSeconds: z.number().int().nonnegative().default(0),
});

export const StepSchema = z.object({
  id: z.string().min(1),
  title: LocalizedTextSchema,
  /** Explicación conceptual del paso. Markdown. */
  body: LocalizedMarkdownSchema,
  /** Instrucción accionable, corta y en imperativo. */
  task: LocalizedTextSchema,
  /** Archivo que se enfoca al entrar en el paso. */
  focusFile: z.string().optional(),
  focusLines: z.tuple([z.number().int(), z.number().int()]).optional(),
  /** IDs de reglas (de `lesson.rules`) que aplican a este paso. */
  ruleIds: z.array(z.string()).default([]),
  hints: z.array(HintSchema).default([]),
  xp: z.number().int().nonnegative().default(25),
  /** Nota de estándar de industria (Clean Code, SOLID, OWASP...). */
  bestPractice: LocalizedMarkdownSchema.optional(),
  /**
   * Estado del workspace que supera ESTE paso.
   *
   * Cuando una lección tiene un ejercicio por paso, la solución final ya no
   * verifica los intermedios: la consulta del paso 3 no cumple —ni debe— las
   * reglas del paso 1. Sin esto, las promesas de los pasos que no son el
   * último se quedan sin comprobar, que es justo donde se cuela un enunciado
   * imposible.
   *
   * **Nunca viaja al cliente** (`toClientLesson` la recorta) y el comprobador
   * de spoilers la trata igual que la solución de la lección.
   */
  solution: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
});

/**
 * Bloque de memoria muscular: 3-4 micro-repeticiones de la MISMA sintaxis
 * con variación superficial, cronometradas. Es la mecánica que convierte
 * "lo entendí" en "lo escribo sin pensar".
 */
export const DrillSchema = z.object({
  id: z.string(),
  prompt: LocalizedTextSchema,
  starter: z.string().default(''),
  /** Solución canónica (para diff y para el modo "mostrar respuesta"). */
  solution: z.string(),
  /** Validación ligera de la repetición. */
  rules: z.array(ValidationRuleSchema).min(1),
  /** Bonus por rapidez; 0 desactiva el cronómetro. */
  targetSeconds: z.number().int().nonnegative().default(45),
});

/* ────────────────────  Retos tipo entrevista  ───────────────────── */

export const InterviewSpecSchema = z.object({
  /** Enunciado tal y como lo plantearía un entrevistador. */
  prompt: LocalizedMarkdownSchema,
  company_style: z.enum(['faang', 'startup', 'enterprise', 'generic']).default('generic'),
  category: z.enum([
    'algorithms', 'data-structures', 'system-design',
    'debugging', 'optimization', 'security', 'infra',
  ]),
  constraints: z.array(LocalizedTextSchema).default([]),
  /** Objetivo de complejidad. Se evalúa por análisis + benchmark. */
  complexity: z.object({
    time: z.string().optional(),   // "O(n log n)"
    space: z.string().optional(),  // "O(1)"
  }).optional(),
  /** Preguntas de seguimiento — lo que realmente distingue en una entrevista. */
  followUps: z.array(z.object({
    question: LocalizedTextSchema,
    answer: LocalizedMarkdownSchema,
  })).default([]),
  /** Rúbrica para `system-design`, donde no hay tests automáticos. */
  rubric: z.array(z.object({
    criterion: LocalizedTextSchema,
    weight: z.number().min(0).max(1),
  })).default([]),
});

/* ────────────────────────  Recompensas  ─────────────────────────── */

export const RewardSchema = z.object({
  baseXp: z.number().int().nonnegative().default(100),
  /** Bonus si se completa sin fallar ninguna regla `damage`. */
  flawlessBonus: z.number().int().nonnegative().default(50),
  /** Bonus si no se usa ninguna pista. */
  noHintBonus: z.number().int().nonnegative().default(25),
  /** Techo del multiplicador de combo aplicable a esta lección. */
  comboMultiplierCap: z.number().min(1).max(5).default(3),
  /** IDs del catálogo `content/achievements/achievements.json`. */
  achievements: z.array(z.string()).default([]),
});

/* ──────────────────────────  Lección  ───────────────────────────── */

export const LessonSchema = z.object({
  $schema: z.string().optional(),
  /** Versión del schema para migraciones. */
  schemaVersion: z.literal(1),

  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  track: TrackSchema,
  /** Módulo dentro del track: 'javascript', 'docker', 'sql'... */
  module: z.string().min(1),
  order: z.number().int().nonnegative(),

  kind: LessonKindSchema,
  difficulty: DifficultySchema,
  estimatedMinutes: z.number().int().positive(),

  title: LocalizedTextSchema,
  summary: LocalizedTextSchema,
  /** Etiquetas conceptuales, para el grafo de prerequisitos y el repaso. */
  concepts: z.array(z.string()).default([]),
  prerequisites: z.array(z.string()).default([]),

  runtime: RuntimeSpecSchema,
  workspace: WorkspaceSchema,

  /** Catálogo de reglas de la lección; los pasos las referencian por id. */
  rules: z.array(ValidationRuleSchema).default([]),
  steps: z.array(StepSchema).min(1),

  /** Bloque de memoria muscular, tras los pasos. */
  drills: z.array(DrillSchema).default([]),

  /** Presente solo si kind === 'interview' | 'system-design'. */
  interview: InterviewSpecSchema.optional(),

  // `prefault` y no `default`: si la lección omite `reward`, se parsea `{}`
  // CON el schema, aplicando los defaults de cada campo. `default` inyectaría
  // el valor tal cual, sin pasar por el parseo.
  reward: RewardSchema.prefault({}),

  /** Solución de referencia, desbloqueable tras completar o rendirse. */
  solution: z.object({
    files: z.array(z.object({ path: z.string(), content: z.string() })),
    explanation: LocalizedMarkdownSchema,
  }).optional(),
})
  /* --- invariantes que el tipo no puede expresar --- */
  .refine(
    (l) => l.workspace.files.some((f) => f.path === l.workspace.entry),
    { message: 'workspace.entry debe apuntar a un fichero declarado en workspace.files' },
  )
  .refine(
    (l) => {
      const ids = new Set(l.rules.map((r) => r.id));
      return l.steps.every((s) => s.ruleIds.every((rid) => ids.has(rid)));
    },
    { message: 'Un step referencia un ruleId inexistente en lesson.rules' },
  )
  .refine(
    (l) => (l.kind === 'interview' || l.kind === 'system-design') === Boolean(l.interview),
    { message: 'El bloque `interview` es obligatorio (y exclusivo) para kind interview/system-design' },
  )
  .refine(
    (l) => l.kind !== 'drill' || l.drills.length >= 3,
    { message: 'Una lección `drill` necesita al menos 3 repeticiones (memoria muscular)' },
  );

/* ──────────────────────────  Logros  ────────────────────────────── */

export const AchievementSchema = z.object({
  id: z.string(),
  title: LocalizedTextSchema,
  description: LocalizedTextSchema,
  icon: z.string(),
  tier: z.enum(['bronze', 'silver', 'gold', 'legendary']),
  xpReward: z.number().int().nonnegative().default(100),
  /** Condición evaluada por `lib/game/achievements.ts`. */
  trigger: z.discriminatedUnion('type', [
    z.object({ type: z.literal('combo-reached'), value: z.number().int() }),
    z.object({ type: z.literal('keystrokes-total'), value: z.number().int() }),
    z.object({ type: z.literal('lessons-completed'), track: TrackSchema.optional(), value: z.number().int() }),
    z.object({ type: z.literal('module-completed'), module: z.string() }),
    z.object({ type: z.literal('flawless-streak'), value: z.number().int() }),
    z.object({ type: z.literal('no-hint-lessons'), value: z.number().int() }),
    z.object({ type: z.literal('interview-solved'), category: z.string(), value: z.number().int() }),
    z.object({ type: z.literal('speed-clear'), underSeconds: z.number().int() }),
  ]),
});

export const AchievementCatalogSchema = z.array(AchievementSchema);
