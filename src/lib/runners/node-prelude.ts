/**
 * Node dentro del navegador, sin WebContainers.
 *
 * ## Por qué esto y no Node de verdad
 *
 * Node de verdad en el navegador existe —WebContainers— y su licencia comercial
 * es el bloqueo declarado en el ADR-07. No hay versión gratuita para lo que esto
 * es. La alternativa de pago sería un runtime remoto: una caja aislada por
 * usuario y por ejecución, que cuesta dinero y latencia en el bucle donde más se
 * itera.
 *
 * Así que se hace lo que sí se puede hacer bien: **JavaScript es JavaScript**.
 * Un `for`, una promesa, un `EventEmitter` o un `require` se comportan igual en
 * el motor del navegador que en el de Node, porque el motor es el mismo. Lo que
 * falta son las **APIs del sistema**, y de esas se implementa aquí un
 * subconjunto honesto: módulos, `path`, `events`, `fs` sobre un sistema de
 * archivos en memoria, `http` con peticiones deterministas y `process`.
 *
 * ## Lo que esto NO es
 *
 * No es Node. No hay hilos, ni red, ni sistema de archivos real, ni `child_process`,
 * ni módulos de npm. Un `require('express')` falla y dice por qué. Se declara
 * aquí, se declara en el ADR-26 y se declara en la lección: aprender el modelo de
 * módulos y el bucle de eventos con esto es legítimo; creer que es un servidor,
 * no.
 *
 * ## Por qué en JavaScript y no en TypeScript
 *
 * Porque se ejecuta dentro del iframe, sin compilar. Y porque así se puede
 * **probar en Node de verdad**: `tests/node-runtime.test.ts` ejecuta este mismo
 * texto con `new Function` y comprueba que `fs`, `events` y `http` se comportan
 * como los de Node — comparándolos, cuando se puede, con los originales.
 */
export const NODE_PRELUDE = String.raw`
(function (global) {
  'use strict';

  /* ── Sistema de archivos en memoria ─────────────────────────────── */

  var FICHEROS = global.__ARCHIVOS__ || {};

  function normalizar(ruta) {
    return String(ruta).replace(/^\.\//, '').replace(/^\//, '');
  }

  var fs = {
    existsSync: function (ruta) {
      return Object.prototype.hasOwnProperty.call(FICHEROS, normalizar(ruta));
    },
    readFileSync: function (ruta, opciones) {
      var clave = normalizar(ruta);
      if (!fs.existsSync(clave)) {
        var error = new Error("ENOENT: no such file or directory, open '" + ruta + "'");
        error.code = 'ENOENT';
        throw error;
      }
      // Sin codificación, Node devuelve un Buffer. Aquí no hay Buffers, así
      // que se devuelve el texto y se dice: es la primera diferencia visible.
      return FICHEROS[clave];
    },
    writeFileSync: function (ruta, contenido) {
      FICHEROS[normalizar(ruta)] = String(contenido);
    },
    appendFileSync: function (ruta, contenido) {
      var clave = normalizar(ruta);
      FICHEROS[clave] = (FICHEROS[clave] || '') + String(contenido);
    },
    unlinkSync: function (ruta) {
      delete FICHEROS[normalizar(ruta)];
    },
    readdirSync: function () {
      return Object.keys(FICHEROS).sort();
    },
    mkdirSync: function () {
      // Los directorios no existen aquí: las rutas son claves de un objeto.
      return undefined;
    },
  };

  /* ── path ───────────────────────────────────────────────────────── */

  var path = {
    sep: '/',
    join: function () {
      var partes = Array.prototype.slice.call(arguments).filter(Boolean);
      return path.normalize(partes.join('/'));
    },
    normalize: function (ruta) {
      var absoluta = String(ruta).charAt(0) === '/';
      var salida = [];
      String(ruta)
        .split('/')
        .forEach(function (parte) {
          if (parte === '' || parte === '.') return;
          if (parte === '..') salida.pop();
          else salida.push(parte);
        });
      return (absoluta ? '/' : '') + salida.join('/');
    },
    basename: function (ruta, ext) {
      var base = String(ruta).split('/').pop() || '';
      if (ext && base.slice(-ext.length) === ext) base = base.slice(0, -ext.length);
      return base;
    },
    dirname: function (ruta) {
      var partes = String(ruta).split('/');
      partes.pop();
      return partes.join('/') || '.';
    },
    extname: function (ruta) {
      var base = path.basename(ruta);
      var punto = base.lastIndexOf('.');
      return punto <= 0 ? '' : base.slice(punto);
    },
    resolve: function () {
      return path.normalize('/' + Array.prototype.join.call(arguments, '/'));
    },
  };

  /* ── events ─────────────────────────────────────────────────────── */

  function EventEmitter() {
    this._eventos = {};
  }

  EventEmitter.prototype.on = function (nombre, oyente) {
    (this._eventos[nombre] = this._eventos[nombre] || []).push(oyente);
    return this;
  };

  EventEmitter.prototype.once = function (nombre, oyente) {
    var self = this;
    function unaVez() {
      self.off(nombre, unaVez);
      oyente.apply(self, arguments);
    }
    return self.on(nombre, unaVez);
  };

  EventEmitter.prototype.off = function (nombre, oyente) {
    var lista = this._eventos[nombre] || [];
    var i = lista.indexOf(oyente);
    if (i >= 0) lista.splice(i, 1);
    return this;
  };

  EventEmitter.prototype.emit = function (nombre) {
    var lista = (this._eventos[nombre] || []).slice();
    var args = Array.prototype.slice.call(arguments, 1);
    lista.forEach(function (oyente) {
      oyente.apply(this, args);
    }, this);
    return lista.length > 0;
  };

  EventEmitter.prototype.listenerCount = function (nombre) {
    return (this._eventos[nombre] || []).length;
  };

  EventEmitter.prototype.removeAllListeners = function (nombre) {
    if (nombre === undefined) this._eventos = {};
    else delete this._eventos[nombre];
    return this;
  };

  /* ── http ───────────────────────────────────────────────────────── */

  /*
   * Un servidor que no escucha en ningún puerto.
   *
   * No hay red: listen no abre nada. Lo que hace es anunciarlo y, acto
   * seguido, atender las peticiones que la lección declara — de forma
   * determinista y en orden. Sin eso, un servidor en el navegador sería un
   * createServer que no se ejecuta nunca y una lección sin salida que
   * comprobar.
   */
  function crearRespuesta(peticion, terminar) {
    var cabeceras = {};
    var cuerpo = '';
    var estado = 200;

    return {
      statusCode: 200,
      setHeader: function (clave, valor) {
        cabeceras[String(clave).toLowerCase()] = valor;
      },
      getHeader: function (clave) {
        return cabeceras[String(clave).toLowerCase()];
      },
      writeHead: function (codigo, cabecerasNuevas) {
        estado = codigo;
        this.statusCode = codigo;
        for (var clave in cabecerasNuevas || {}) {
          cabeceras[String(clave).toLowerCase()] = cabecerasNuevas[clave];
        }
        return this;
      },
      write: function (trozo) {
        cuerpo += String(trozo);
        return true;
      },
      end: function (trozo) {
        if (trozo !== undefined) cuerpo += String(trozo);
        terminar({
          status: this.statusCode !== 200 ? this.statusCode : estado,
          headers: cabeceras,
          body: cuerpo,
        });
      },
    };
  }

  var http = {
    createServer: function (manejador) {
      var servidor = new EventEmitter();
      servidor._manejador = manejador;

      servidor.listen = function (puerto, callback) {
        console.log('Servidor escuchando en el puerto ' + puerto);
        if (typeof callback === 'function') callback();

        var peticiones = global.__PETICIONES__ || [];
        peticiones.forEach(function (cruda) {
          var peticion = {
            method: cruda.method || 'GET',
            url: cruda.url || '/',
            headers: cruda.headers || {},
          };
          var respuesta = crearRespuesta(peticion, function (resultado) {
            console.log(
              peticion.method + ' ' + peticion.url + ' -> ' + resultado.status + ' ' + resultado.body,
            );
          });
          servidor._manejador(peticion, respuesta);
        });

        return servidor;
      };

      return servidor;
    },
  };

  /* ── process ────────────────────────────────────────────────────── */

  var colaTicks = [];

  function drenarTicks() {
    while (colaTicks.length > 0) {
      var siguiente = colaTicks.shift();
      siguiente();
    }
  }

  var process = {
    argv: ['node', 'main.js'],
    env: { NODE_ENV: 'development' },
    platform: 'browser',
    version: 'v20.0.0-simulado',
    cwd: function () {
      return '/app';
    },
    exit: function (codigo) {
      console.log('Proceso terminado con código ' + (codigo || 0));
    },
    /*
     * nextTick tiene cola propia, y va ANTES que las promesas.
     *
     * Implementarlo como Promise.resolve().then(fn) —que es lo que parece
     * equivalente— lo mete en la misma cola de microtareas y por tanto DESPUÉS
     * de cualquier promesa ya encolada. La lección enseña el orden de Node
     * (síncrono, nextTick, promesas, temporizadores) y la simulación estaba
     * enseñando otro: se vio comparando la salida con la del Node de verdad.
     *
     * Aquí la cola se vacía justo al terminar el código síncrono, que es
     * exactamente cuando Node la vacía. Límite conocido y declarado: un
     * nextTick encolado dentro de una promesa no se adelanta a las microtareas
     * que ya estuvieran esperando.
     */
    nextTick: function (fn) {
      colaTicks.push(fn);
    },
    stdout: {
      write: function (texto) {
        console.log(String(texto).replace(/\n$/, ''));
        return true;
      },
    },
  };

  /* ── require y module ───────────────────────────────────────────── */

  var NUCLEO = {
    fs: fs,
    path: path,
    events: Object.assign(EventEmitter, { EventEmitter: EventEmitter }),
    http: http,
    os: {
      EOL: '\n',
      platform: function () {
        return 'browser';
      },
    },
    util: {
      inspect: function (valor) {
        try {
          return JSON.stringify(valor);
        } catch (e) {
          return String(valor);
        }
      },
      format: function () {
        return Array.prototype.join.call(arguments, ' ');
      },
    },
    assert: Object.assign(
      function (condicion, mensaje) {
        if (!condicion) throw new Error(mensaje || 'Assertion failed');
      },
      {
        equal: function (a, b, mensaje) {
          if (a != b) throw new Error(mensaje || a + ' != ' + b);
        },
        strictEqual: function (a, b, mensaje) {
          if (a !== b) throw new Error(mensaje || a + ' !== ' + b);
        },
        ok: function (valor, mensaje) {
          if (!valor) throw new Error(mensaje || 'Assertion failed');
        },
      },
    ),
  };

  var cache = {};

  function require(nombre) {
    var limpio = String(nombre).replace(/^node:/, '');

    if (Object.prototype.hasOwnProperty.call(NUCLEO, limpio)) return NUCLEO[limpio];

    // Un módulo del usuario: se busca el archivo y se ejecuta una sola vez.
    if (limpio.charAt(0) === '.') {
      var ruta = normalizar(limpio);
      var candidatos = [ruta, ruta + '.js', ruta + '/index.js'];

      for (var i = 0; i < candidatos.length; i++) {
        var clave = candidatos[i];
        if (!Object.prototype.hasOwnProperty.call(FICHEROS, clave)) continue;
        if (cache[clave]) return cache[clave].exports;

        var modulo = { exports: {} };
        cache[clave] = modulo;

        var fabricar = new Function('require', 'module', 'exports', 'process', '__filename', FICHEROS[clave]);
        fabricar(require, modulo, modulo.exports, process, clave);
        return modulo.exports;
      }

      var faltante = new Error("Cannot find module '" + nombre + "'");
      faltante.code = 'MODULE_NOT_FOUND';
      throw faltante;
    }

    /*
     * Un paquete de npm. No los hay, y se dice con todas las letras en vez de
     * fallar con un «undefined is not a function» tres líneas más abajo.
     */
    var error = new Error(
      "Cannot find module '" +
        nombre +
        "'. Aquí no hay npm: solo los módulos del núcleo (" +
        Object.keys(NUCLEO).sort().join(', ') +
        ') y los archivos de la lección.',
    );
    error.code = 'MODULE_NOT_FOUND';
    throw error;
  }

  global.require = require;
  global.process = process;
  global.module = { exports: {} };
  global.exports = global.module.exports;
  global.__filename = 'main.js';
  global.__dirname = '/app';
  global.__NODE_FS__ = FICHEROS;

  /*
   * Los módulos del núcleo quedan a la vista para que otro prelude añada los
   * suyos. Es lo que hace el de Nest (ADR-28): registra '@nestjs/common' aquí
   * y así un 'import { Controller } from ...' se resuelve por el mismo
   * require, con la misma caché, en vez de duplicar el cargador de módulos.
   */
  global.__NUCLEO__ = NUCLEO;
  global.__drenarTicks__ = drenarTicks;
})(typeof window !== 'undefined' ? window : globalThis);
`;
