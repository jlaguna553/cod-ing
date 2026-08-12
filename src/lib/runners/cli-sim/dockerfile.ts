/**
 * Parser de Dockerfile.
 *
 * Lo usan dos consumidores: el simulador de `docker build` (para decidir qué
 * capas se cachean) y el validador `dockerfile-lint` de la Fase 4. Vive aquí
 * y no dentro del escenario para que ambos compartan exactamente la misma
 * lectura del archivo — si divergieran, la terminal diría una cosa y la
 * evaluación otra.
 */

export interface DockerInstruction {
  /** FROM, RUN, COPY… siempre en mayúsculas. */
  instruction: string;
  args: string;
  /** 1-indexado, para poder señalar la línea en el editor. */
  line: number;
  /** Nombre de la fase (`AS builder`) a la que pertenece esta instrucción. */
  stage: string | null;
}

export interface DockerStage {
  name: string | null;
  baseImage: string;
  /** Fase de la que copia (`COPY --from=builder`). */
  copiesFrom: string[];
  instructions: DockerInstruction[];
}

export interface ParsedDockerfile {
  instructions: DockerInstruction[];
  stages: DockerStage[];
}

export function parseDockerfile(source: string): ParsedDockerfile {
  const instructions: DockerInstruction[] = [];
  const stages: DockerStage[] = [];
  let currentStage: DockerStage | null = null;

  const rawLines = source.split('\n');
  let buffer = '';
  let bufferStartLine = 0;

  rawLines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;

    // Continuación con barra invertida: `RUN a && \` + `    b`.
    if (buffer === '') bufferStartLine = index + 1;
    if (line.endsWith('\\')) {
      buffer += `${line.slice(0, -1).trim()} `;
      return;
    }

    const full = `${buffer}${line}`.trim();
    buffer = '';

    const match = full.match(/^(\w+)\s*(.*)$/);
    if (!match) return;

    const instruction = match[1].toUpperCase();
    const args = match[2].trim();

    if (instruction === 'FROM') {
      const stageMatch = args.match(/^(\S+)(?:\s+AS\s+(\S+))?$/i);
      currentStage = {
        name: stageMatch?.[2] ?? null,
        baseImage: stageMatch?.[1] ?? args,
        copiesFrom: [],
        instructions: [],
      };
      stages.push(currentStage);
    }

    if (instruction === 'COPY' && currentStage) {
      const fromMatch = args.match(/--from=(\S+)/);
      if (fromMatch) currentStage.copiesFrom.push(fromMatch[1]);
    }

    const parsed: DockerInstruction = {
      instruction,
      args,
      line: bufferStartLine,
      stage: currentStage?.name ?? null,
    };

    instructions.push(parsed);
    currentStage?.instructions.push(parsed);
  });

  return { instructions, stages };
}

/**
 * Rutas de origen de un `COPY`/`ADD`, sin el destino ni las banderas.
 * Es lo que determina si la capa se invalida cuando cambia el código.
 */
export function copySources(args: string): string[] {
  const parts = args
    .replace(/--\S+/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // El último es el destino dentro de la imagen.
  return parts.slice(0, -1);
}
