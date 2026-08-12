import type { Runner, RuntimeKind } from './types';
import { RunnerBootError } from './types';

/**
 * Crea el runner que pide la lección.
 *
 * Los runners se cargan con `import()` dinámico para que ninguna lección
 * arrastre el peso de un motor que no usa: una lección de CSS no debería
 * descargar el bundler de Sandpack.
 *
 * Estado de implementación (Fase 3), decidido por cobertura de contenido:
 *
 * | kind           | lecciones | estado                                    |
 * |----------------|-----------|-------------------------------------------|
 * | `dom`          | 8         | ✅ implementado                            |
 * | `sandpack`     | 5         | ✅ implementado                            |
 * | `cli-sim`      | 1         | ✅ implementado                            |
 * | `webcontainer` | 1         | ⏸️ bloqueado por la licencia (ADR-07)      |
 * | `pyodide`      | 0         | ⏸️ sin contenido que lo use                |
 * | `remote`       | 0         | ⏸️ sin contenido que lo use                |
 *
 * Los tres pendientes no son deuda: construir un motor antes de que exista
 * una sola lección que lo ejercite es código sin usuario que valide su diseño.
 */
export async function createRunner(kind: RuntimeKind, mount: HTMLElement): Promise<Runner> {
  switch (kind) {
    case 'dom': {
      const { DomRunner } = await import('./dom');
      return new DomRunner(mount);
    }

    case 'sandpack': {
      const { SandpackRunner } = await import('./sandpack');
      return new SandpackRunner(mount);
    }

    case 'cli-sim': {
      const { CliSimRunner } = await import('./cli-sim');
      return new CliSimRunner();
    }

    case 'webcontainer':
      throw new RunnerBootError(
        'El runtime `webcontainer` está pendiente de resolver la licencia comercial de ' +
          'WebContainers (ADR-07). Hasta entonces, esta lección no puede ejecutarse.',
      );

    case 'pyodide':
    case 'remote':
      throw new RunnerBootError(
        `El runtime \`${kind}\` se implementará cuando exista contenido que lo use.`,
      );

    default: {
      const exhaustive: never = kind;
      throw new RunnerBootError(`Runtime desconocido: ${String(exhaustive)}`);
    }
  }
}

/** La UI solo necesita saber esto del runner: ¿iframe o terminal? */
export function usesTerminal(kind: RuntimeKind): boolean {
  return kind === 'cli-sim' || kind === 'webcontainer' || kind === 'remote' || kind === 'pyodide';
}
