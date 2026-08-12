import { copySources, parseDockerfile, type DockerInstruction } from './dockerfile';
import { matchesAny, VirtualFs } from './vfs';

/**
 * Simulación de `docker build` centrada en LO ÚNICO que importa aquí: cuándo
 * una capa se reutiliza y cuándo se reconstruye.
 *
 * No ejecuta nada. Calcula, por cada instrucción, una huella a partir de la
 * propia instrucción y —para `COPY`/`ADD`— del contenido de los archivos que
 * toca. Si la huella coincide con la del build anterior Y todas las capas
 * previas también coincidieron, la capa sale `CACHED`.
 *
 * Esa segunda condición es la lección entera: **una capa invalidada invalida
 * todas las siguientes**. Por eso `COPY . .` antes de `npm ci` destruye la
 * caché de dependencias con cualquier cambio de código, y el usuario lo ve
 * ocurrir en su terminal en lugar de leerlo en un párrafo.
 */

export interface LayerResult {
  step: number;
  total: number;
  instruction: string;
  args: string;
  cached: boolean;
  /** Segundos simulados. Las capas cacheadas cuestan 0. */
  seconds: number;
}

export interface BuildResult {
  ok: boolean;
  layers: LayerResult[];
  totalSeconds: number;
  imageSizeMb: number;
  output: string[];
  error?: string;
}

/** Coste simulado por instrucción, en segundos. Aproximado pero verosímil. */
function costOf(instruction: DockerInstruction, dockerignore: string[]): number {
  switch (instruction.instruction) {
    case 'FROM':
      return instruction.args.includes('alpine') ? 3 : 12;
    case 'RUN': {
      const args = instruction.args;
      if (/npm (ci|install)/.test(args)) return args.includes('--omit=dev') ? 28 : 46;
      if (/npm run build|tsc|go build|mvn/.test(args)) return 34;
      if (/apt-get|apk add/.test(args)) return 22;
      return 4;
    }
    case 'COPY':
    case 'ADD': {
      // Sin .dockerignore, `COPY . .` arrastra node_modules al daemon.
      const sources = copySources(instruction.args);
      const copiesEverything = sources.some((source) => source === '.' || source === './');
      const ignoresModules = dockerignore.some((line) => line.includes('node_modules'));
      return copiesEverything && !ignoresModules ? 18 : 2;
    }
    default:
      return 0;
  }
}

/** Huella de una instrucción: su texto más el contenido que consume. */
function fingerprintOf(instruction: DockerInstruction, fs: VirtualFs, dockerignore: string[]): string {
  const base = `${instruction.instruction} ${instruction.args}`;

  if (instruction.instruction !== 'COPY' && instruction.instruction !== 'ADD') {
    return base;
  }
  // `COPY --from=<stage>` copia de otra fase, no del contexto de build.
  if (/--from=/.test(instruction.args)) return base;

  const sources = copySources(instruction.args);
  const visible = fs
    .paths()
    .filter((path) => !matchesAny(path, dockerignore) && matchesAny(path, sources));

  return `${base}::${fs.fingerprint(visible)}`;
}

export function dockerBuild(
  fs: VirtualFs,
  previousFingerprints: string[] | null,
): { result: BuildResult; fingerprints: string[] } {
  const source = fs.read('Dockerfile');
  if (source === null) {
    return {
      result: {
        ok: false,
        layers: [],
        totalSeconds: 0,
        imageSizeMb: 0,
        output: ['ERROR: no se encontró Dockerfile en el contexto de build'],
        error: 'no-dockerfile',
      },
      fingerprints: [],
    };
  }

  const parsed = parseDockerfile(source);
  const dockerignore = (fs.read('.dockerignore') ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  if (parsed.instructions.length === 0) {
    return {
      result: {
        ok: false,
        layers: [],
        totalSeconds: 0,
        imageSizeMb: 0,
        output: ['ERROR: el Dockerfile está vacío'],
        error: 'empty-dockerfile',
      },
      fingerprints: [],
    };
  }

  const fingerprints: string[] = [];
  const layers: LayerResult[] = [];
  const output: string[] = [];
  let cacheStillValid = previousFingerprints !== null;
  let totalSeconds = 0;

  parsed.instructions.forEach((instruction, index) => {
    const fingerprint = fingerprintOf(instruction, fs, dockerignore);
    fingerprints.push(fingerprint);

    // La caché sobrevive solo si esta capa Y todas las anteriores coinciden.
    const matchesPrevious = previousFingerprints?.[index] === fingerprint;
    const cached = cacheStillValid && matchesPrevious;
    if (!cached) cacheStillValid = false;

    const seconds = cached ? 0 : costOf(instruction, dockerignore);
    totalSeconds += seconds;

    layers.push({
      step: index + 1,
      total: parsed.instructions.length,
      instruction: instruction.instruction,
      args: instruction.args,
      cached,
      seconds,
    });

    const header = `Step ${index + 1}/${parsed.instructions.length} : ${instruction.instruction} ${instruction.args}`;
    output.push(header);
    output.push(cached ? ' ---> Using cache' : ` ---> Running in ${randomId()} (${seconds}s)`);
  });

  const imageSizeMb = estimateSize(parsed, dockerignore);
  output.push(`Successfully built ${randomId()}`);
  output.push(`Image size: ${imageSizeMb} MB · Build time: ${totalSeconds}s`);

  return {
    result: { ok: true, layers, totalSeconds, imageSizeMb, output },
    fingerprints,
  };
}

/**
 * Tamaño estimado de la imagen final.
 *
 * Solo cuenta la última fase: es exactamente lo que hace un multi-stage real,
 * y es lo que permite que el usuario vea caer la cifra al partir el Dockerfile.
 */
function estimateSize(
  parsed: ReturnType<typeof parseDockerfile>,
  dockerignore: string[],
): number {
  const finalStage = parsed.stages.at(-1);
  if (!finalStage) return 0;

  let size = finalStage.baseImage.includes('alpine') ? 55 : 380;

  for (const instruction of finalStage.instructions) {
    if (instruction.instruction === 'RUN') {
      if (/npm ci --omit=dev|npm install --production/.test(instruction.args)) size += 65;
      else if (/npm (ci|install)/.test(instruction.args)) size += 240;
      else if (/npm run build|tsc/.test(instruction.args)) size += 15;
    }
    if (instruction.instruction === 'COPY' && !/--from=/.test(instruction.args)) {
      const sources = copySources(instruction.args);
      const everything = sources.some((source) => source === '.' || source === './');
      const ignoresModules = dockerignore.some((line) => line.includes('node_modules'));
      size += everything && !ignoresModules ? 190 : 4;
    }
  }

  return size;
}

function randomId(): string {
  return Math.random().toString(16).slice(2, 14);
}
