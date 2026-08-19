import assert from 'node:assert/strict';
import test from 'node:test';
import nodePath from 'node:path';
import { EventEmitter as NodeEventEmitter } from 'node:events';
import { NODE_PRELUDE } from '@/lib/runners/node-prelude';

/**
 * El Node simulado, comparado con el de verdad.
 *
 * Esta es la parte que hace defendible el ADR-26: el prelude se ejecuta **en
 * Node**, con `new Function`, exactamente como se ejecutará en el iframe, y lo
 * que devuelve se compara con lo que devuelven los módulos originales — que
 * están aquí al lado, importados arriba.
 *
 * Sin esto, «`path.join` funciona como el de Node» sería una afirmación mía. Y
 * la mitad del valor de una simulación está en saber exactamente en qué se
 * parece y en qué no.
 */

interface Entorno {
  require: (nombre: string) => never;
  process: { argv: string[]; env: Record<string, string>; cwd: () => string };
  ejecutar: (codigo: string) => unknown;
  salida: string[];
}

/** Monta el prelude sobre un global fingido y devuelve con qué trabajar. */
function montar(archivos: Record<string, string> = {}): Entorno {
  const salida: string[] = [];
  const global: Record<string, unknown> = {
    __ARCHIVOS__: { ...archivos },
    __PETICIONES__: [],
    console: {
      log: (...args: unknown[]) => salida.push(args.map(String).join(' ')),
      error: (...args: unknown[]) => salida.push(args.map(String).join(' ')),
      warn: () => {},
      info: () => {},
    },
    Promise,
    JSON,
    Error,
    Object,
    Array,
    String,
    Function,
  };

  // El prelude se instala sobre `globalThis` del ámbito que se le pase.
  new Function('window', `with (window) { ${NODE_PRELUDE} }`)(global);

  return {
    require: global.require as never,
    process: global.process as never,
    salida,
    ejecutar: (codigo: string) =>
      new Function('require', 'process', 'console', 'module', 'exports', codigo)(
        global.require,
        global.process,
        global.console,
        { exports: {} },
        {},
      ),
  };
}

test('⭐ path se comporta como el de Node en los casos que se enseñan', () => {
  const { require } = montar();
  const path = require('path') as unknown as typeof nodePath;

  for (const caso of [
    ['src', 'lib', 'index.js'],
    ['src/', '/lib', 'index.js'],
    ['a', '..', 'b'],
  ] as const) {
    assert.equal(
      path.join(...caso),
      nodePath.join(...caso),
      `join(${caso.join(', ')}) no coincide con el de Node`,
    );
  }

  assert.equal(path.basename('/a/b/c.txt'), nodePath.basename('/a/b/c.txt'));
  assert.equal(path.basename('/a/b/c.txt', '.txt'), nodePath.basename('/a/b/c.txt', '.txt'));
  assert.equal(path.extname('index.test.js'), nodePath.extname('index.test.js'));
  assert.equal(path.extname('sin-extension'), nodePath.extname('sin-extension'));
  assert.equal(path.dirname('/a/b/c.txt'), nodePath.dirname('/a/b/c.txt'));
});

test('⭐ EventEmitter emite, deja de emitir y cuenta como el de Node', () => {
  const { require } = montar();
  const { EventEmitter } = require('events') as unknown as { EventEmitter: typeof NodeEventEmitter };

  for (const Clase of [EventEmitter, NodeEventEmitter]) {
    const emisor = new Clase();
    const recibido: string[] = [];

    const oyente = (dato: string) => recibido.push(dato);
    emisor.on('dato', oyente);
    emisor.once('dato', (dato: string) => recibido.push('una-vez:' + dato));

    emisor.emit('dato', 'a');
    emisor.emit('dato', 'b');
    emisor.off('dato', oyente);
    emisor.emit('dato', 'c');

    assert.deepEqual(recibido, ['a', 'una-vez:a', 'b'], `${Clase.name} no coincide`);
    assert.equal(emisor.listenerCount('dato'), 0);
  }
});

test('⭐ fs escribe y lee sobre el sistema de archivos de la lección', () => {
  const { require } = montar({ 'datos.txt': 'hola' });
  const fs = require('fs') as unknown as {
    readFileSync: (r: string) => string;
    writeFileSync: (r: string, c: string) => void;
    appendFileSync: (r: string, c: string) => void;
    existsSync: (r: string) => boolean;
    readdirSync: () => string[];
  };

  assert.equal(fs.readFileSync('datos.txt'), 'hola');
  assert.equal(fs.existsSync('datos.txt'), true);
  assert.equal(fs.existsSync('no-existe.txt'), false);

  fs.writeFileSync('nuevo.txt', 'contenido');
  fs.appendFileSync('nuevo.txt', ' más');
  assert.equal(fs.readFileSync('nuevo.txt'), 'contenido más');
  assert.deepEqual(fs.readdirSync(), ['datos.txt', 'nuevo.txt']);
});

test('⭐ leer un archivo que no existe falla con ENOENT, como en Node', () => {
  const { require } = montar();
  const fs = require('fs') as unknown as { readFileSync: (r: string) => string };

  assert.throws(
    () => fs.readFileSync('fantasma.txt'),
    (error: NodeJS.ErrnoException) => {
      // El código importa: es lo que se captura en un `catch` de verdad.
      assert.equal(error.code, 'ENOENT');
      assert.match(error.message, /no such file or directory/);
      return true;
    },
  );
});

test('⭐ require de un paquete de npm dice que no hay npm, y qué sí hay', () => {
  const { require } = montar();

  assert.throws(
    () => require('express'),
    (error: NodeJS.ErrnoException) => {
      assert.equal(error.code, 'MODULE_NOT_FOUND');
      // Un «undefined is not a function» tres líneas después no enseña nada.
      assert.match(error.message, /Aquí no hay npm/);
      assert.match(error.message, /events/);
      return true;
    },
  );
});

test('⭐ un módulo del usuario se carga una sola vez', () => {
  const entorno = montar({
    'contador.js': 'let veces = 0; veces++; module.exports = { veces };',
  });

  const resultado = entorno.ejecutar(`
    const a = require('./contador');
    const b = require('./contador');
    return a === b && a.veces === 1;
  `);

  // La caché de módulos no es un detalle: es lo que hace que un módulo de
  // configuración tenga el mismo estado en toda la aplicación.
  assert.equal(resultado, true);
});

test('⭐ module.exports y exports apuntan al mismo objeto, con la trampa incluida', () => {
  const entorno = montar({
    'suma.js': 'exports.suma = (a, b) => a + b;',
    'roto.js': 'exports = { suma: () => 0 };',
  });

  assert.equal(
    entorno.ejecutar("return require('./suma').suma(2, 3);"),
    5,
  );

  // Reasignar `exports` rompe la exportación: es el error clásico y aquí se
  // reproduce igual que en Node, en vez de disimularlo.
  assert.deepEqual(entorno.ejecutar("return require('./roto');"), {});
});

test('⭐ un servidor http atiende las peticiones que declara la lección', () => {
  const salida: string[] = [];
  const global: Record<string, unknown> = {
    __ARCHIVOS__: {},
    __PETICIONES__: [
      { method: 'GET', url: '/' },
      { method: 'GET', url: '/salud' },
    ],
    console: { log: (...a: unknown[]) => salida.push(a.map(String).join(' ')) },
    Promise,
    JSON,
    Error,
    Object,
    Array,
    String,
    Function,
  };
  new Function('window', `with (window) { ${NODE_PRELUDE} }`)(global);

  const requerir = global.require as (n: string) => {
    createServer: (m: (req: { url: string }, res: Record<string, unknown>) => void) => {
      listen: (p: number, cb?: () => void) => void;
    };
  };

  const http = requerir('http');
  const servidor = http.createServer((req, res) => {
    const r = res as unknown as {
      writeHead: (c: number, h: Record<string, string>) => void;
      end: (b: string) => void;
    };
    if (req.url === '/salud') {
      r.writeHead(200, { 'content-type': 'application/json' });
      r.end('{"ok":true}');
    } else {
      r.writeHead(404, {});
      r.end('No encontrado');
    }
  });

  servidor.listen(3000);

  assert.deepEqual(salida, [
    'Servidor escuchando en el puerto 3000',
    'GET / -> 404 No encontrado',
    'GET /salud -> 200 {"ok":true}',
  ]);
});

test('process trae lo justo, y lo dice', () => {
  const { process } = montar();
  assert.equal(process.cwd(), '/app');
  assert.equal(process.env.NODE_ENV, 'development');
  assert.deepEqual(process.argv, ['node', 'main.js']);
});

test('⭐ el orden del bucle de eventos es el de Node, comparado con el de Node', async () => {
  const simulado: string[] = [];
  const global: Record<string, unknown> = {
    __ARCHIVOS__: {},
    __PETICIONES__: [],
    console: { log: (...a: unknown[]) => simulado.push(a.map(String).join(' ')) },
    Promise,
    JSON,
    Error,
    Object,
    Array,
    String,
    Function,
  };
  new Function('window', `with (window) { ${NODE_PRELUDE} }`)(global);

  const proceso = global.process as { nextTick: (fn: () => void) => void };
  const drenar = global.__drenarTicks__ as () => void;
  const real: string[] = [];

  /*
   * Los dos programas arrancan desde una macrotarea limpia.
   *
   * Medido desde dentro de una microtarea —que es donde está el cuerpo de un
   * test `async`— el propio Node ordena distinto: ya se está drenando la cola
   * de promesas, así que un `nextTick` nuevo espera a que termine. El código
   * de una lección arranca en el nivel superior, y eso es lo que se compara.
   */
  await new Promise<void>((listo) => {
    setTimeout(() => {
      // El mismo programa, dos veces: aquí sobre la simulación…
      simulado.push('sincrono');
      setTimeout(() => simulado.push('timeout'), 0);
      void Promise.resolve().then(() => simulado.push('promesa'));
      proceso.nextTick(() => simulado.push('tick'));
      drenar(); // lo que el runner añade al final del código del usuario

      // …y aquí sobre el Node de verdad, con sus propias primitivas.
      real.push('sincrono');
      setTimeout(() => real.push('timeout'), 0);
      void Promise.resolve().then(() => real.push('promesa'));
      process.nextTick(() => real.push('tick'));

      setTimeout(listo, 20);
    }, 0);
  });

  /*
   * Implementar `nextTick` como `Promise.resolve().then(...)` parece
   * equivalente y no lo es: lo mete en la cola de las promesas, así que iba
   * DESPUÉS de una promesa ya encolada. La lección enseña el orden de Node, y
   * la simulación enseñaba otro. Esta comparación es lo que lo destapó.
   */
  assert.deepEqual(simulado, real, 'la simulación ordena distinto que Node');
  assert.deepEqual(real, ['sincrono', 'tick', 'promesa', 'timeout']);
});
