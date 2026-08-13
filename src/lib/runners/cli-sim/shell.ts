import { dockerBuild } from './docker-build';
import { isTemplate, scaffoldVite, VITE_TEMPLATES } from './npm-scenario';
import { VirtualFs } from './vfs';

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Archivos creados o modificados por el comando, para propagarlos. */
  touched: string[];
}

/**
 * Shell simulada, independiente del contrato `Runner`.
 *
 * Se extrajo de `CliSimRunner` al hacer la terminal **ortogonal al runtime**:
 * una lección de React con Sandpack también quiere consola, y no tendría
 * sentido que para tenerla renunciara a su preview. La terminal dejó de ser
 * un tipo de runner para ser una capacidad que cualquiera puede componer.
 *
 * Es determinista por diseño (ADR-03): mismas entradas, mismas salidas, sin
 * red ni relojes. Eso la hace probable en Node y reproducible entre sesiones.
 */
export class Shell {
  private cwd = '';
  private history: string[] = [];
  private lastBuildFingerprints: string[] | null = null;
  private devServerRunning = false;

  constructor(
    private fs: VirtualFs,
    private allowedCommands: string[] = [],
  ) {}

  getCwd(): string {
    return this.cwd === '' ? '/' : `/${this.cwd}`;
  }

  getTranscript(): string[] {
    return [...this.history];
  }

  getFs(): VirtualFs {
    return this.fs;
  }

  reset(fs: VirtualFs) {
    this.fs = fs;
    this.cwd = '';
    this.history = [];
    this.lastBuildFingerprints = null;
    this.devServerRunning = false;
  }

  execute(input: string): ShellResult {
    const command = input.trim();
    if (command === '') return ok('');

    this.history.push(command);

    const blocked = this.checkAllowed(command);
    if (blocked) return { stdout: '', stderr: blocked, exitCode: 126, touched: [] };

    const [binary, ...args] = command.split(/\s+/);

    switch (binary) {
      case 'npm':
      case 'npx':
        return this.npm(args, binary);
      case 'docker':
        return this.docker(args);
      case 'ls':
        return this.ls(args);
      case 'cat':
        return this.cat(args);
      case 'cd':
        return this.cd(args);
      case 'pwd':
        return ok(this.getCwd());
      case 'mkdir':
        return this.mkdir(args);
      case 'touch':
        return this.touch(args);
      case 'rm':
        return this.rm(args);
      case 'echo':
        return ok(args.join(' ').replace(/^["']|["']$/g, ''));
      case 'clear':
        return ok('\x1b[2J\x1b[H');
      case 'node':
        return ok(`v20.19.0`);
      default:
        return fail(`${binary}: command not found`, 127);
    }
  }

  /* ── npm ─────────────────────────────────────────────────────── */

  private npm(args: string[], binary: string): ShellResult {
    const [subcommand, ...rest] = args;

    // `npm create vite@latest app -- --template react`
    if (subcommand === 'create' || (binary === 'npx' && rest[0] === 'create-vite')) {
      const target = rest.find((arg) => !arg.startsWith('-') && !arg.includes('@')) ?? 'app';
      const templateFlag = args.indexOf('--template');
      const template = templateFlag >= 0 ? args[templateFlag + 1] : 'react';

      if (!isTemplate(template)) {
        return fail(
          `Plantilla "${template}" no disponible. Prueba con: ${VITE_TEMPLATES.join(', ')}`,
        );
      }

      const base = this.resolve(target);
      if (this.fs.exists(base)) {
        return fail(`El directorio ${target} ya existe y no está vacío.`);
      }

      const created = scaffoldVite(this.fs, base, template);
      return {
        stdout: [
          `> npx create-vite ${target} --template ${template}`,
          '',
          `Scaffolding project in /${base}...`,
          '',
          'Done. Now run:',
          '',
          `  cd ${target}`,
          '  npm install',
          '  npm run dev',
          '',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
        touched: created,
      };
    }

    if (subcommand === 'install' || subcommand === 'i' || subcommand === 'ci') {
      const manifestPath = this.resolve('package.json');
      const manifest = this.fs.read(manifestPath);

      if (manifest === null) {
        return fail(
          `npm error: no se encontró package.json en ${this.getCwd()}.\n` +
            '¿Estás en la carpeta del proyecto? Prueba `cd` primero.',
        );
      }

      const parsed = safeParse(manifest);
      const deps = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
      const names = Object.keys(deps);

      // El árbol se llena de verdad: es lo que hace creíble la instalación.
      const touched: string[] = [];
      for (const name of names) {
        const marker = this.resolve(`node_modules/${name}/package.json`);
        this.fs.write(marker, `{"name":"${name}","version":"${deps[name]}"}`);
        touched.push(marker);
      }

      return {
        stdout: [
          `added ${names.length * 47} packages in ${8 + names.length}s`,
          '',
          `${names.length * 12} packages are looking for funding`,
          '  run `npm fund` for details',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
        touched,
      };
    }

    if (subcommand === 'run') {
      const script = rest[0];
      const manifest = safeParse(this.fs.read(this.resolve('package.json')) ?? '{}');
      const scripts = manifest.scripts ?? {};

      if (!script) return fail('npm error: falta el nombre del script');
      if (!scripts[script]) {
        return fail(
          `npm error: script "${script}" no existe. Disponibles: ${Object.keys(scripts).join(', ') || 'ninguno'}`,
        );
      }
      if (!this.fs.exists(this.resolve('node_modules'))) {
        return fail(
          'npm error: falta node_modules. Instala las dependencias antes de ejecutar scripts.',
        );
      }

      if (script === 'dev' || script === 'start') {
        this.devServerRunning = true;
        return ok(
          [
            '',
            '  VITE v5.4.0  ready in 412 ms',
            '',
            '  ➜  Local:   http://localhost:5173/',
            '  ➜  press h + enter to show help',
          ].join('\n'),
        );
      }

      if (script === 'build') {
        return ok(['vite v5.4.0 building for production...', '✓ built in 1.24s'].join('\n'));
      }

      return ok(`> ${scripts[script]}`);
    }

    return fail(`npm: subcomando "${subcommand ?? ''}" no simulado en esta lección.`);
  }

  isDevServerRunning(): boolean {
    return this.devServerRunning;
  }

  /* ── docker ──────────────────────────────────────────────────── */

  private docker(args: string[]): ShellResult {
    const [subcommand] = args;

    if (subcommand === 'build') {
      const { result, fingerprints } = dockerBuild(this.fs, this.lastBuildFingerprints);
      this.lastBuildFingerprints = result.ok ? fingerprints : null;
      return result.ok
        ? ok(result.output.join('\n'))
        : fail(result.output.join('\n'));
    }

    if (subcommand === 'images') {
      return ok(
        'REPOSITORY   TAG      IMAGE ID       CREATED         SIZE\napi          latest   a1b2c3d4e5f6   2 minutes ago   —',
      );
    }

    if (subcommand === 'history') {
      const dockerfile = this.fs.read('Dockerfile') ?? '';
      const secrets = dockerfile
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^(ENV|ARG)\s+\w*(KEY|TOKEN|SECRET|PASSWORD)/i.test(line));

      // La última capa se toma del Dockerfile real. Inventarla desmiente a la
      // propia lección: el usuario acaba de escribir su CMD y la salida le
      // enseñaba otro, que es justo el tipo de detalle que hace desconfiar de
      // un simulador.
      const cmd =
        dockerfile
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => /^CMD\s/i.test(line))
          .at(-1) ?? 'CMD ["node" "server.js"]';

      const base =
        'IMAGE          CREATED         CREATED BY                     SIZE\n' +
        `a1b2c3d4e5f6   2 minutes ago   ${cmd}   0B`;

      // Que el secreto aparezca aquí es el objetivo de simular este subcomando.
      return ok(
        secrets.length > 0
          ? `${base}\n${secrets.map((line) => `               2 minutes ago   ${line}   0B`).join('\n')}`
          : base,
      );
    }

    return fail(`docker: '${subcommand ?? ''}' no está simulado en esta lección.`);
  }

  /* ── utilidades de archivos ──────────────────────────────────── */

  private ls(args: string[]): ShellResult {
    const target = args.find((arg) => !arg.startsWith('-')) ?? '';
    const entries = this.fs.list(this.resolve(target));
    return ok(entries.join('  '));
  }

  private cat(args: string[]): ShellResult {
    if (!args[0]) return fail('cat: falta el nombre del archivo');
    const content = this.fs.read(this.resolve(args[0]));
    return content === null
      ? fail(`cat: ${args[0]}: No such file or directory`)
      : ok(content.trimEnd());
  }

  private cd(args: string[]): ShellResult {
    const target = args[0] ?? '';

    if (target === '' || target === '~' || target === '/') {
      this.cwd = '';
      return ok('');
    }
    if (target === '..') {
      this.cwd = this.cwd.split('/').slice(0, -1).join('/');
      return ok('');
    }

    const next = this.resolve(target);
    if (!this.fs.exists(next)) return fail(`cd: ${target}: No such file or directory`);
    if (!this.fs.isDirectory(next)) return fail(`cd: ${target}: Not a directory`);

    this.cwd = next;
    return ok('');
  }

  private mkdir(args: string[]): ShellResult {
    const target = args.find((arg) => !arg.startsWith('-'));
    if (!target) return fail('mkdir: falta el operando');
    // El FS es plano: un directorio existe si algo cuelga de él.
    const marker = `${this.resolve(target)}/.gitkeep`;
    this.fs.write(marker, '');
    return { stdout: '', stderr: '', exitCode: 0, touched: [marker] };
  }

  private touch(args: string[]): ShellResult {
    if (!args[0]) return fail('touch: falta el nombre del archivo');
    const target = this.resolve(args[0]);
    if (!this.fs.exists(target)) this.fs.write(target, '');
    return { stdout: '', stderr: '', exitCode: 0, touched: [target] };
  }

  private rm(args: string[]): ShellResult {
    const target = args.find((arg) => !arg.startsWith('-'));
    if (!target) return fail('rm: falta el operando');
    const removed = this.fs.delete(this.resolve(target));
    return removed > 0
      ? { stdout: '', stderr: '', exitCode: 0, touched: [] }
      : fail(`rm: ${target}: No such file or directory`);
  }

  /* ── interno ─────────────────────────────────────────────────── */

  /** Resuelve una ruta relativa contra el directorio actual. */
  private resolve(target: string): string {
    const clean = target.replace(/^\.\//, '').replace(/\/+$/, '');
    if (clean.startsWith('/')) return clean.slice(1);
    if (this.cwd === '') return clean;
    return clean === '' ? this.cwd : `${this.cwd}/${clean}`;
  }

  /**
   * Barandilla pedagógica, no de seguridad — no hay nada que proteger en un FS
   * virtual. Evita que alguien salga del ejercicio y acabe en un estado que la
   * lección no sabe explicar.
   */
  private checkAllowed(command: string): string | null {
    if (this.allowedCommands.length === 0) return null;

    const permitted = this.allowedCommands.some(
      (prefix) => command === prefix || command.startsWith(`${prefix} `),
    );
    if (permitted) return null;

    const binary = command.split(/\s+/)[0];
    return `${binary}: comando no disponible en esta lección. Permitidos: ${this.allowedCommands.join(', ')}`;
  }
}

function ok(stdout: string): ShellResult {
  return { stdout, stderr: '', exitCode: 0, touched: [] };
}

function fail(stderr: string, exitCode = 1): ShellResult {
  return { stdout: '', stderr, exitCode, touched: [] };
}

function safeParse(value: string): Record<string, never> & {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
} {
  try {
    return JSON.parse(value);
  } catch {
    return {} as never;
  }
}
