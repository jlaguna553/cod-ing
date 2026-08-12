import type { FileMap, LocalizedRuntimeSpec, OutputChunk, RunResult, Runner } from '../types';
import { OutputEmitter } from '../types';
import { Shell } from './shell';
import { VirtualFs } from './vfs';

export { VirtualFs } from './vfs';
export { Shell } from './shell';
export { dockerBuild } from './docker-build';
export { parseDockerfile, copySources } from './dockerfile';
export { scaffoldVite, VITE_TEMPLATES } from './npm-scenario';

/**
 * Runner de línea de comandos simulada (ADR-03).
 *
 * No existe forma de correr un demonio de Docker o un cluster de Kubernetes
 * dentro de un navegador, así que se simula de forma **determinista**: un FS
 * virtual y una tabla de comandos con salidas realistas.
 *
 * Este runner es la variante *sin preview*: la lección ocurre entera en la
 * terminal (DevOps). Cuando una lección necesita terminal **y** vista previa
 * —React montado con Vite, por ejemplo— no se usa esta clase: se activa
 * `runtime.terminal.enabled` sobre el runner de preview y se compone un
 * `Shell` al lado. La terminal es una capacidad, no un tipo de runtime.
 */
export class CliSimRunner implements Runner {
  readonly kind = 'cli-sim' as const;

  private fs = new VirtualFs();
  private shell = new Shell(this.fs);
  private emitter = new OutputEmitter();
  private spec: LocalizedRuntimeSpec | null = null;

  async boot(spec: LocalizedRuntimeSpec, files: FileMap): Promise<void> {
    this.spec = spec;
    this.fs = new VirtualFs(files);
    this.shell = new Shell(this.fs, spec.terminal?.allowedCommands ?? []);

    const greeting = spec.terminal?.greeting;
    if (typeof greeting === 'string' && greeting !== '') {
      this.emitter.emit('system', `${greeting}\n`);
    }
    this.emitter.emit('system', `${this.shell.getCwd()} $ `);
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.fs.write(path, content);
  }

  async run(command?: string): Promise<RunResult> {
    const input = (command ?? this.spec?.command ?? '').trim();
    const startedAt = Date.now();

    if (input === '') return { exitCode: 0, stdout: '', stderr: '', durationMs: 0 };

    this.emitter.emit('stdout', `${input}\n`);
    const result = this.shell.execute(input);

    if (result.stdout) this.emitter.emit('stdout', `${result.stdout}\n`);
    if (result.stderr) this.emitter.emit('stderr', `${result.stderr}\n`);
    this.emitter.emit('system', `${this.shell.getCwd()} $ `);

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
      artifacts: {
        transcript: this.shell.getTranscript(),
        files: this.fs.toRecord(),
        touched: result.touched,
      },
    };
  }

  onOutput(cb: (chunk: OutputChunk) => void) {
    return this.emitter.on(cb);
  }

  async reset(): Promise<void> {
    this.shell.reset(this.fs);
  }

  dispose(): void {
    this.emitter.clear();
  }

  getTranscript(): string[] {
    return this.shell.getTranscript();
  }
}
