import type { FileMap, LocalizedRuntimeSpec, RunResult, Runner } from './types';
import { OutputEmitter, RunnerBootError } from './types';
import { PHP_PRELUDE, PRELUDE_LINES } from './php-prelude';

/**
 * PHP en el navegador, interpretado de verdad (ADR-20).
 *
 * ## Por qué no PHP compilado a WebAssembly
 *
 * Existe —`@php-wasm`, el motor de WordPress Playground— y es PHP completo.
 * Pero son **más de 10 MB** de descarga por visitante para enseñar `echo` y
 * `foreach`, y su licencia es GPL, que sobre una aplicación entera no es una
 * decisión de una tarde. Aquí se usa **Uniter**, un intérprete de PHP escrito
 * en JavaScript, MIT y de 1,1 MB, que se carga solo en las lecciones que lo
 * piden.
 *
 * ## Qué se ejecuta y qué no
 *
 * Es un intérprete real, no un simulador: analiza el código del usuario y lo
 * ejecuta. Variables, tipos, arrays asociativos, `foreach`, funciones con
 * argumentos por defecto y por referencia, closures, clases, herencia,
 * excepciones, interpolación de cadenas y heredoc funcionan como en PHP.
 *
 * Lo que **no** hay se dice en voz alta: la sintaxis es la de PHP 5.x con
 * añadidos, así que no acepta expresiones flecha (`fn() =>`) ni el operador
 * `**`; y su biblioteca estándar viene a medias, por lo que se completa con
 * `php-prelude.ts` —escrito en PHP— con las funciones que un ejercicio usa en
 * la primera línea. Las lecciones se escriben dentro de ese subconjunto, y el
 * comprobador de contenido ejecuta **cada solución con este mismo motor**: una
 * lección que se salga no llega a publicarse.
 *
 * ## Por qué se carga desde nuestro origen
 *
 * Igual que PGlite (ADR-11) y el runtime de Vue (ADR-13): el paquete trae un
 * bundle UMD ya construido que se copia a `public/php/` en cada build. Ni CDN
 * de terceros que pueda caerse o estar bloqueado, ni 1,1 MB metidos en el
 * bundle de una aplicación en la que la mayoría de las lecciones no son de PHP.
 */

/** Motor de Uniter, en lo poco que se usa de él. */
interface PhpEngine {
  execute(code: string): Promise<unknown>;
  getStdout(): { on(event: 'data', cb: (data: string) => void): void };
  getStderr(): { on(event: 'data', cb: (data: string) => void): void };
}

interface UniterGlobal {
  createEngine(language: 'PHP'): PhpEngine;
}

const SCRIPT_URL = '/php/uniter.js';

/**
 * Carga el bundle una sola vez y devuelve lo que exporta.
 *
 * **No con un `<script>`.** El bundle es UMD y su primera comprobación es si
 * existe `define.amd`: en esta pantalla existe, porque Monaco trae su propio
 * cargador AMD. Con un `<script>` el intérprete se registraba como módulo
 * anónimo de Monaco y no publicaba `window.uniter` — el arranque fallaba con
 * un «no se pudo cargar» que no decía nada, y solo en la pantalla de juego:
 * cargándolo desde cualquier otra página funcionaba.
 *
 * Se le da entonces la rama de CommonJS, que es determinista: se pide el
 * archivo, se ejecuta con su propio `module` y se recoge lo que exporte. Nada
 * de globales, nada que dependa de qué otro cargador haya en la página.
 *
 * Tampoco con `import()`: es un bundle ya resuelto por browserify y pedirle al
 * bundler que lo reempaquete no aporta nada y sí arrastra sus dependencias.
 */
let cargando: Promise<UniterGlobal> | null = null;

function cargarUniter(): Promise<UniterGlobal> {
  cargando ??= (async () => {
    const respuesta = await fetch(SCRIPT_URL);
    if (!respuesta.ok) throw new Error(`No se pudo descargar ${SCRIPT_URL} (${respuesta.status}).`);

    const codigo = await respuesta.text();
    const modulo = { exports: {} as UniterGlobal };
    new Function('module', 'exports', codigo)(modulo, modulo.exports);

    if (typeof modulo.exports?.createEngine !== 'function') {
      throw new Error('El bundle se cargó pero no exporta `createEngine`.');
    }
    return modulo.exports;
  })();

  return cargando;
}

export class PhpRunner implements Runner {
  readonly kind = 'php' as const;

  private uniter: UniterGlobal | null = null;
  private files: FileMap = {};
  private entry: string | null = null;
  private emitter = new OutputEmitter();

  async boot(_spec: LocalizedRuntimeSpec, files: FileMap, entry?: string): Promise<void> {
    this.files = { ...files };
    this.entry = entry ?? null;

    this.emitter.emit('system', 'Arrancando PHP…\n');

    try {
      this.uniter = await cargarUniter();
    } catch (cause) {
      throw new RunnerBootError('No se pudo arrancar el intérprete de PHP.', cause);
    }

    this.emitter.emit('system', 'PHP listo.\n');
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files[path] = content;
  }

  /**
   * Ejecuta el archivo de entrada.
   *
   * Cada ejecución estrena motor. Compartirlo dejaría vivas las variables y
   * las funciones declaradas en la anterior, y el resultado dependería de
   * cuántas veces hubieras pulsado «Ejecutar» — que es justo lo que impide que
   * una evaluación signifique algo.
   */
  async run(command?: string): Promise<RunResult> {
    const startedAt = Date.now();
    const fuente = command ?? this.files[this.entry ?? ''] ?? '';

    if (!this.uniter) return this.fallo('El intérprete no está listo.', startedAt);
    if (fuente.trim() === '') return this.fallo('No hay código que ejecutar.', startedAt);

    const engine = this.uniter.createEngine('PHP');
    let stdout = '';
    let stderr = '';

    engine.getStdout().on('data', (data) => {
      const texto = String(data);
      stdout += texto;
      this.emitter.emit('stdout', texto);
    });
    engine.getStderr().on('data', (data) => {
      stderr += String(data);
    });

    try {
      await engine.execute(this.montar(fuente));
      return { exitCode: 0, stdout, stderr, durationMs: Date.now() - startedAt };
    } catch (cause) {
      /*
       * El error de PHP se enseña tal cual, solo con las líneas corregidas.
       * «Call to undefined function» o «unexpected ';'» dicen exactamente qué
       * pasa, y leerlos es parte de aprender el lenguaje. Lo único que se
       * traduce es el número de línea, que sin ajustar apuntaría al prelude.
       */
      const mensaje = this.recolocar(cause instanceof Error ? cause.message : String(cause));
      this.emitter.emit('stderr', `${mensaje}\n`);

      return {
        exitCode: 255,
        stdout,
        stderr: `${stderr}${mensaje}`,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  /**
   * Junta el prelude y el código del usuario en un único script.
   *
   * Se le quita su `<?php` de apertura: dentro de un archivo ya abierto sería
   * un error de sintaxis, y el usuario lo escribe porque así se escribe PHP.
   */
  private montar(fuente: string): string {
    const cuerpo = fuente.replace(/^﻿?\s*<\?php\s*/i, '');
    return `<?php ${PHP_PRELUDE}\n${cuerpo}`;
  }

  /** Resta las líneas del prelude a los números que aparezcan en el error. */
  private recolocar(mensaje: string): string {
    return mensaje.replace(/on line (\d+)/g, (original, numero: string) => {
      const real = Number(numero) - PRELUDE_LINES;
      return real > 0 ? `on line ${real}` : original;
    });
  }

  private fallo(mensaje: string, startedAt: number): RunResult {
    this.emitter.emit('stderr', `${mensaje}\n`);
    return {
      exitCode: 1,
      stdout: '',
      stderr: mensaje,
      durationMs: Date.now() - startedAt,
    };
  }

  onOutput(cb: Parameters<OutputEmitter['on']>[0]) {
    return this.emitter.on(cb);
  }

  async reset(): Promise<void> {
    // No hay estado que limpiar: cada ejecución estrena motor.
  }

  dispose(): void {
    this.emitter.clear();
  }
}
