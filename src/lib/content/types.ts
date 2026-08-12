/**
 * Tipos TS derivados del schema Zod. No se escriben a mano.
 * `import type { Lesson } from '@/lib/content/types'` en toda la app.
 */
import type { z } from 'zod';
import type {
  AchievementSchema,
  DifficultySchema,
  DrillSchema,
  HintSchema,
  InterviewSpecSchema,
  LessonKindSchema,
  LessonSchema,
  LocaleSchema,
  LocalizedTextSchema,
  RewardSchema,
  RulePhaseSchema,
  RuleSeveritySchema,
  RuntimeKindSchema,
  RuntimeSpecSchema,
  StepSchema,
  TrackSchema,
  ValidationRuleSchema,
  WorkspaceFileSchema,
  WorkspaceSchema,
} from './lesson.schema';

export type Locale = z.infer<typeof LocaleSchema>;
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

export type Track = z.infer<typeof TrackSchema>;
export type Difficulty = z.infer<typeof DifficultySchema>;
export type LessonKind = z.infer<typeof LessonKindSchema>;

export type RuntimeKind = z.infer<typeof RuntimeKindSchema>;
export type RuntimeSpec = z.infer<typeof RuntimeSpecSchema>;

export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type FileMap = Record<string, string>;

export type RulePhase = z.infer<typeof RulePhaseSchema>;
export type RuleSeverity = z.infer<typeof RuleSeveritySchema>;
export type ValidationRule = z.infer<typeof ValidationRuleSchema>;
export type RuleKind = ValidationRule['kind'];

export type Hint = z.infer<typeof HintSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Drill = z.infer<typeof DrillSchema>;
export type InterviewSpec = z.infer<typeof InterviewSpecSchema>;
export type Reward = z.infer<typeof RewardSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type Achievement = z.infer<typeof AchievementSchema>;

/* ───────────  Proyección segura hacia el cliente  ─────────── */

/**
 * Una pista, tal y como la ve el cliente ANTES de revelarla: se conoce su
 * coste y su nivel, pero no su texto. El texto se pide a `/api/hint` en el
 * momento de revelar, que es cuando se cobra el XP.
 */
export interface ClientHint {
  id: string;
  tier: number;
  xpPenalty: number;
  autoOfferAfterSeconds: number;
  /** Presente solo tras revelarla. */
  text?: string;
}

/**
 * Lección tal y como viaja al navegador.
 *
 * Se le quitan tres cosas que nunca deben salir del servidor:
 *   1. `solution` — el código resuelto.
 *   2. el texto de las pistas — cuestan XP; si viajan, son gratis.
 *   3. las reglas con `hidden: true` — son los tests que no se enseñan.
 *
 * No es paranoia: el payload RSC es texto plano en el HTML. Sin este recorte,
 * "abrir devtools" es una estrategia ganadora y la economía de XP se cae.
 */
export type ClientLesson = Omit<
  { [K in keyof Lesson]: LocalizedValue<Lesson[K]> },
  'solution' | 'steps'
> & {
  steps: (Omit<LocalizedStep, 'hints'> & { hints: ClientHint[] })[];
};

/** Utilidades internas para expresar "el mismo tipo, ya localizado". */
type LocalizedValue<T> = T extends LocalizedText
  ? string
  : T extends readonly (infer U)[]
    ? LocalizedValue<U>[]
    : T extends object
      ? { [K in keyof T]: LocalizedValue<T[K]> }
      : T;

export type LocalizedStep = { [K in keyof Step]: LocalizedValue<Step[K]> };

/* ─────────────  Contratos del motor de evaluación  ───────────── */

/** Resultado de evaluar una regla. Lo consume la UI y el store de gamificación. */
export interface RuleResult {
  ruleId: string;
  kind: RuleKind;
  passed: boolean;
  severity: RuleSeverity;
  /** Ya localizado: el engine resuelve el locale, la UI solo pinta. */
  message: string;
  points: number;
  /** Para decoraciones de "daño" en el editor. */
  location?: { file: string; line: number; column?: number; endLine?: number };
  /** Diff observado vs esperado (tests, stdout). */
  detail?: { expected?: string; actual?: string };
}

export interface StepEvaluation {
  stepId: string;
  passed: boolean;
  results: RuleResult[];
  score: number;
  maxScore: number;
}

/* ─────────────────────  Contrato del Runner  ─────────────────── */

export interface OutputChunk {
  stream: 'stdout' | 'stderr' | 'system';
  data: string;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Artefactos específicos del runner: URL de preview, documento DOM, capas de imagen... */
  artifacts?: Record<string, unknown>;
}

export type Unsubscribe = () => void;

/**
 * Contrato único de ejecución (ADR-02). Sandpack, WebContainers, Pyodide,
 * el runner remoto y el simulador de CLI implementan esto. La UI no
 * distingue entre ellos más allá de `kind` (iframe vs terminal).
 */
/**
 * La spec tal y como la ve un runner: ya resuelta a un idioma.
 *
 * Los runners se ejecutan en el cliente, que solo recibe contenido localizado
 * (ver `ClientLesson`). Pedirles la versión bilingüe obligaría a que conocieran
 * el locale, que es justo lo que `localize()` existe para evitar.
 */
export type LocalizedRuntimeSpec = LocalizedValue<RuntimeSpec>;

export interface Runner {
  readonly kind: RuntimeKind;
  boot(spec: LocalizedRuntimeSpec, files: FileMap, entry?: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  run(command?: string): Promise<RunResult>;
  onOutput(cb: (chunk: OutputChunk) => void): Unsubscribe;
  reset(): Promise<void>;
  dispose(): void;
}
