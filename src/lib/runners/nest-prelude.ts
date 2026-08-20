/**
 * NestJS, reducido a su contrato (ADR-28).
 *
 * ## Qué es esto
 *
 * Nest son decoradores, un contenedor de dependencias y un despachador de
 * rutas. Nada de eso necesita un servidor: los decoradores son una función que
 * recibe una clase, el contenedor es un mapa de clase → instancia, y el
 * despachador es una tabla de rutas. Lo que sí necesitaría un servidor —abrir
 * un puerto— es justo lo que aquí se sustituye por las peticiones que declara
 * la lección, igual que en el `http` del prelude de Node.
 *
 * Se apoya en ese prelude: los módulos `@nestjs/common` y `@nestjs/core` se
 * registran en su tabla de módulos del núcleo, así que un
 * `import { Controller } from '@nestjs/common'` se resuelve por el mismo
 * `require`, con la misma caché. El TypeScript de la lección se compila a
 * CommonJS antes de llegar aquí.
 *
 * ## Lo que NO es
 *
 * No es Nest. No hay `@nestjs/platform-express`, ni pipes de validación, ni
 * interceptores, ni guards, ni ámbitos de petición: todos los proveedores son
 * singletons de la aplicación. Los errores que sí se reproducen palabra por
 * palabra son los dos con los que se tropieza todo el mundo —«Nest can't
 * resolve dependencies» y el 404 de una ruta sin mapear—, porque el valor de
 * la lección está en reconocerlos.
 *
 * ## Por qué en JavaScript
 *
 * Porque se ejecuta dentro del iframe sin compilar, y porque así
 * `tests/nest-runtime.test.ts` puede ejecutar este mismo texto en Node y
 * comprobar el contenedor y el enrutado sin navegador de por medio.
 */
export const NEST_PRELUDE = String.raw`
(function (global) {
  'use strict';

  var NUCLEO = global.__NUCLEO__;
  if (!NUCLEO) throw new Error('El prelude de Nest necesita el de Node por delante.');

  /* ── Reflect.metadata ───────────────────────────────────────────── */

  /*
   * Sin esto no hay inyección por tipos.
   *
   * TypeScript, con emitDecoratorMetadata, emite una llamada a
   * Reflect.metadata('design:paramtypes', [UsuariosService]) por cada clase
   * decorada: ahí es donde queda escrito qué pide el constructor. El navegador
   * trae Reflect, pero no esa parte —vive en el paquete reflect-metadata—, y
   * el ayudante que emite TypeScript comprueba si existe y, si no, NO HACE
   * NADA. El resultado sería un contenedor que cree que ninguna clase depende
   * de nada: todo undefined y ni un error. Se implementa lo justo.
   */
  var METADATOS = new WeakMap();

  function clave(nombre, propiedad) {
    return propiedad === undefined ? nombre : nombre + '::' + String(propiedad);
  }

  function definirMeta(nombre, valor, objetivo, propiedad) {
    if (!METADATOS.has(objetivo)) METADATOS.set(objetivo, {});
    METADATOS.get(objetivo)[clave(nombre, propiedad)] = valor;
  }

  function leerMeta(nombre, objetivo, propiedad) {
    var tabla = METADATOS.get(objetivo);
    return tabla ? tabla[clave(nombre, propiedad)] : undefined;
  }

  /*
   * Se instala SIEMPRE, aunque ya hubiera un Reflect.metadata puesto.
   *
   * Quien escribe los metadatos es el ayudante que emite TypeScript, y quien
   * los lee es el contenedor de aqui abajo: si uno apunta a la tabla de una
   * ejecucion anterior y el otro a la nueva, el contenedor no encuentra nada y
   * acusa de faltarle @Injectable() a una clase que lo tiene. En el navegador
   * cada ejecucion estrena iframe y no se nota; en un test que ejecuta varios
   * proyectos seguidos, se nota a la primera.
   */
  Reflect.metadata = function (nombre, valor) {
    return function (objetivo, propiedad) {
      definirMeta(nombre, valor, objetivo, propiedad);
    };
  };
  Reflect.defineMetadata = function (nombre, valor, objetivo, propiedad) {
    definirMeta(nombre, valor, objetivo, propiedad);
  };
  Reflect.getMetadata = function (nombre, objetivo, propiedad) {
    return leerMeta(nombre, objetivo, propiedad);
  };

  /* ── Decoradores ────────────────────────────────────────────────── */

  function normalizarRuta(ruta) {
    var limpia = String(ruta || '').replace(/^\/+/, '').replace(/\/+$/, '');
    return limpia === '' ? '' : '/' + limpia;
  }

  function Injectable() {
    return function (clase) {
      definirMeta('nest:injectable', true, clase);
    };
  }

  function Controller(prefijo) {
    return function (clase) {
      definirMeta('nest:controlador', normalizarRuta(prefijo), clase);
    };
  }

  function Module(definicion) {
    return function (clase) {
      definirMeta('nest:modulo', definicion || {}, clase);
    };
  }

  /*
   * Las rutas se guardan en el prototipo, que es lo que recibe un decorador de
   * método, y en ORDEN DE DECLARACIÓN. El orden importa: gana la primera que
   * encaja, así que /usuarios/nuevo tiene que declararse antes que
   * /usuarios/:id o se lo come el parámetro. Es el comportamiento de Nest y
   * uno de sus tropiezos clásicos.
   */
  function rutasDe(prototipo) {
    var lista = leerMeta('nest:rutas', prototipo);
    if (!lista) {
      lista = [];
      definirMeta('nest:rutas', lista, prototipo);
    }
    return lista;
  }

  function verbo(metodo) {
    return function (ruta) {
      return function (prototipo, nombre) {
        rutasDe(prototipo).push({
          metodo: metodo,
          ruta: normalizarRuta(ruta),
          manejador: nombre,
        });
      };
    };
  }

  function extractor(tipo) {
    return function (dato) {
      return function (prototipo, nombre, indice) {
        var lista = leerMeta('nest:params', prototipo, nombre) || [];
        lista[indice] = { tipo: tipo, dato: dato };
        definirMeta('nest:params', lista, prototipo, nombre);
      };
    };
  }

  /* ── Excepciones ────────────────────────────────────────────────── */

  /*
   * Un constructor que devuelve un Error de verdad: así conserva la pila y se
   * puede lanzar. El cuerpo que sale por la respuesta tiene la forma exacta de
   * Nest —message, error, statusCode— porque es lo que el alumno va a ver en
   * el navegador cuando esto le pase en un proyecto.
   */
  function HttpException(respuesta, estado) {
    var texto = typeof respuesta === 'string' ? respuesta : 'Http Exception';
    var error = new Error(texto);
    error.esHttp = true;
    error.status = estado || 500;
    error.respuesta = respuesta;
    return error;
  }

  function excepcion(estado, etiqueta) {
    return function (mensaje) {
      return HttpException(mensaje === undefined ? etiqueta : mensaje, estado);
    };
  }

  var NotFoundException = excepcion(404, 'Not Found');
  var BadRequestException = excepcion(400, 'Bad Request');
  var ConflictException = excepcion(409, 'Conflict');

  var ETIQUETAS = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    500: 'Internal Server Error',
  };

  function cuerpoDeError(error) {
    if (typeof error.respuesta === 'object' && error.respuesta !== null) return error.respuesta;
    return {
      message: error.message,
      error: ETIQUETAS[error.status] || 'Error',
      statusCode: error.status,
    };
  }

  /* ── Contenedor ─────────────────────────────────────────────────── */

  function nombreDe(clase) {
    return (clase && clase.name) || 'undefined';
  }

  /**
   * Reúne lo que un módulo ve: lo suyo, más lo que EXPORTAN los que importa.
   *
   * Que un proveedor esté en otro módulo no basta —tiene que estar en su lista
   * de exports—, y esa es la mitad de los «Nest can't resolve dependencies»
   * que se ven en la vida real.
   */
  function recolectar(claseModulo, visitados) {
    var definicion = leerMeta('nest:modulo', claseModulo);
    if (!definicion) {
      throw new Error(
        'La clase ' + nombreDe(claseModulo) + ' no tiene @Module(). ' +
          'NestFactory.create() necesita un modulo raiz decorado.',
      );
    }

    if (visitados.indexOf(claseModulo) !== -1) return { proveedores: [], controladores: [] };
    visitados.push(claseModulo);

    var proveedores = (definicion.providers || []).slice();
    var controladores = (definicion.controllers || []).slice();

    (definicion.imports || []).forEach(function (importado) {
      var dentro = recolectar(importado, visitados);
      var exportados = leerMeta('nest:modulo', importado).exports || [];

      exportados.forEach(function (proveedor) {
        if (proveedores.indexOf(proveedor) === -1) proveedores.push(proveedor);
      });
      // Los controladores de un modulo importado SI se montan: no hace falta
      // exportarlos, porque no los inyecta nadie.
      dentro.controladores.forEach(function (controlador) {
        if (controladores.indexOf(controlador) === -1) controladores.push(controlador);
      });
    });

    return { proveedores: proveedores, controladores: controladores };
  }

  function crearContenedor(claseModulo) {
    var alcance = recolectar(claseModulo, []);
    var instancias = new Map();
    var nombreModulo = nombreDe(claseModulo);

    function instanciar(clase) {
      if (instancias.has(clase)) return instancias.get(clase);

      var tipos = leerMeta('design:paramtypes', clase) || [];

      /*
       * Una clase con dependencias y sin decorador no deja metadatos, así que
       * el contenedor la vería como si no pidiera nada y la construiria con
       * undefined dentro. Nest falla mas tarde y peor; aqui se dice de una vez.
       */
      if (tipos.length === 0 && clase.length > 0) {
        throw new Error(
          'Nest can\'t resolve dependencies of the ' + nombreDe(clase) + '. ' +
            'Le falta @Injectable(): sin decorador no se emiten los metadatos ' +
            'de sus parametros y el contenedor no sabe que necesita.',
        );
      }

      var faltante = -1;
      tipos.forEach(function (tipo, indice) {
        var conocido = alcance.proveedores.indexOf(tipo) !== -1;
        if (!conocido && faltante === -1) faltante = indice;
      });

      if (faltante !== -1) {
        var firma = tipos
          .map(function (tipo, indice) {
            return indice === faltante ? '?' : nombreDe(tipo);
          })
          .join(', ');

        throw new Error(
          'Nest can\'t resolve dependencies of the ' + nombreDe(clase) + ' (' + firma + '). ' +
            'Please make sure that the argument ' + nombreDe(tipos[faltante]) +
            ' at index [' + faltante + '] is available in the ' + nombreModulo + ' context.',
        );
      }

      var argumentos = tipos.map(function (tipo) {
        return instanciar(tipo);
      });

      var instancia = new (Function.prototype.bind.apply(
        clase,
        [null].concat(argumentos),
      ))();
      instancias.set(clase, instancia);
      return instancia;
    }

    return { alcance: alcance, instanciar: instanciar };
  }

  /* ── Enrutado ───────────────────────────────────────────────────── */

  function aPatron(ruta) {
    var nombres = [];
    var expresion = ruta.replace(/:([A-Za-z0-9_]+)/g, function (_todo, nombre) {
      nombres.push(nombre);
      return '([^/]+)';
    });
    return { regex: new RegExp('^' + (expresion === '' ? '/?' : expresion) + '$'), nombres: nombres };
  }

  function partirUrl(url) {
    var trozos = String(url).split('?');
    var consulta = {};
    (trozos[1] || '').split('&').forEach(function (par) {
      if (par === '') return;
      var mitades = par.split('=');
      consulta[decodeURIComponent(mitades[0])] = decodeURIComponent(mitades[1] || '');
    });
    var camino = trozos[0].replace(/\/+$/, '');
    return { camino: camino === '' ? '/' : camino, consulta: consulta };
  }

  function crearAplicacion(claseModulo) {
    console.log('[Nest] LOG [NestFactory] Starting Nest application...');

    var contenedor = crearContenedor(claseModulo);
    var tabla = [];

    contenedor.alcance.controladores.forEach(function (claseControlador) {
      var prefijo = leerMeta('nest:controlador', claseControlador);
      if (prefijo === undefined) {
        throw new Error(
          'La clase ' + nombreDe(claseControlador) + ' esta en controllers pero no tiene @Controller().',
        );
      }

      var instancia = contenedor.instanciar(claseControlador);
      console.log(
        '[Nest] LOG [RoutesResolver] ' + nombreDe(claseControlador) + ' {' + (prefijo || '/') + '}:',
      );

      rutasDe(claseControlador.prototype).forEach(function (ruta) {
        var completa = (prefijo + ruta.ruta) || '/';
        tabla.push({
          metodo: ruta.metodo,
          patron: aPatron(completa),
          ruta: completa,
          instancia: instancia,
          manejador: ruta.manejador,
          prototipo: claseControlador.prototype,
        });
        console.log('[Nest] LOG [RouterExplorer] Mapped {' + completa + ', ' + ruta.metodo + '} route');
      });
    });

    console.log('[Nest] LOG [InstanceLoader] ' + nombreDe(claseModulo) + ' dependencies initialized');

    function responder(peticion, estado, cuerpo) {
      var texto = cuerpo === undefined ? '' : JSON.stringify(cuerpo);
      console.log(peticion.method + ' ' + peticion.url + ' -> ' + estado + ' ' + texto);
    }

    function atender(peticion) {
      var metodo = (peticion.method || 'GET').toUpperCase();
      var partes = partirUrl(peticion.url || '/');

      var encontrada = null;
      var parametros = {};

      for (var i = 0; i < tabla.length; i++) {
        if (tabla[i].metodo !== metodo) continue;
        var coincidencia = partes.camino.match(tabla[i].patron.regex);
        if (!coincidencia) continue;

        encontrada = tabla[i];
        tabla[i].patron.nombres.forEach(function (nombre, indice) {
          parametros[nombre] = coincidencia[indice + 1];
        });
        break;
      }

      if (!encontrada) {
        responder(peticion, 404, {
          message: 'Cannot ' + metodo + ' ' + partes.camino,
          error: 'Not Found',
          statusCode: 404,
        });
        return Promise.resolve();
      }

      var cuerpoPeticion = {};
      if (typeof peticion.body === 'string' && peticion.body !== '') {
        try {
          cuerpoPeticion = JSON.parse(peticion.body);
        } catch (error) {
          cuerpoPeticion = peticion.body;
        }
      }

      var descriptores = leerMeta('nest:params', encontrada.prototipo, encontrada.manejador) || [];
      var argumentos = [];
      for (var j = 0; j < descriptores.length; j++) {
        var descriptor = descriptores[j];
        if (!descriptor) {
          argumentos.push(undefined);
        } else if (descriptor.tipo === 'param') {
          argumentos.push(descriptor.dato ? parametros[descriptor.dato] : parametros);
        } else if (descriptor.tipo === 'query') {
          argumentos.push(descriptor.dato ? partes.consulta[descriptor.dato] : partes.consulta);
        } else {
          argumentos.push(cuerpoPeticion);
        }
      }

      return Promise.resolve()
        .then(function () {
          return encontrada.instancia[encontrada.manejador].apply(encontrada.instancia, argumentos);
        })
        .then(function (resultado) {
          // Un POST responde 201 sin que nadie lo pida: es de Nest, sorprende
          // la primera vez y conviene verlo aqui y no en una revision.
          responder(peticion, metodo === 'POST' ? 201 : 200, resultado);
        })
        .catch(function (error) {
          if (error && error.esHttp) {
            responder(peticion, error.status, cuerpoDeError(error));
            return;
          }
          console.log('[Nest] ERROR ' + (error && error.message ? error.message : error));
          responder(peticion, 500, {
            message: 'Internal server error',
            statusCode: 500,
          });
        });
    }

    return {
      listen: function (puerto) {
        console.log(
          '[Nest] LOG [NestApplication] Nest application successfully started on port ' + puerto,
        );

        var peticiones = global.__PETICIONES__ || [];
        var cadena = Promise.resolve();
        peticiones.forEach(function (peticion) {
          cadena = cadena.then(function () {
            return atender(peticion);
          });
        });
        return cadena;
      },
      /** Para poder probar el enrutado sin pasar por listen. */
      atender: atender,
    };
  }

  NUCLEO['@nestjs/common'] = {
    Injectable: Injectable,
    Controller: Controller,
    Module: Module,
    Get: verbo('GET'),
    Post: verbo('POST'),
    Put: verbo('PUT'),
    Patch: verbo('PATCH'),
    Delete: verbo('DELETE'),
    Param: extractor('param'),
    Query: extractor('query'),
    Body: extractor('body'),
    HttpException: HttpException,
    NotFoundException: NotFoundException,
    BadRequestException: BadRequestException,
    ConflictException: ConflictException,
  };

  NUCLEO['@nestjs/core'] = {
    NestFactory: {
      /*
       * Un fallo al montar la aplicacion se IMPRIME, no se propaga.
       *
       * Nest lo saca por su ExceptionHandler y mata el proceso; aqui no hay
       * proceso que matar, y dejar que la promesa se rechace solo conseguiria
       * que el mensaje —que es la leccion entera— se perdiera entre el ruido
       * de un rechazo sin capturar. Se imprime igual que lo imprime Nest y la
       * aplicacion se queda sin arrancar: ni rutas, ni respuestas.
       */
      create: function (claseModulo) {
        try {
          return Promise.resolve(crearAplicacion(claseModulo));
        } catch (error) {
          console.log(
            '[Nest] ERROR [ExceptionHandler] ' +
              (error && error.message ? error.message : error),
          );
          return Promise.resolve({
            listen: function () {
              return Promise.resolve();
            },
            atender: function () {
              return Promise.resolve();
            },
          });
        }
      },
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
`;

/**
 * Declaraciones de `@nestjs/common` y `@nestjs/core` para el editor.
 *
 * No existen en disco: sin esto, el `import` de la primera línea de cualquier
 * lección sería un error de tipos y no se ejecutaría nada. Describen justo lo
 * que el prelude implementa — ni un método de más, para que el editor no
 * prometa lo que el runtime no tiene.
 */
export const NEST_TIPOS = `
declare module '@nestjs/common' {
  export function Injectable(): ClassDecorator;
  export function Controller(prefijo?: string): ClassDecorator;
  export function Module(definicion: {
    imports?: unknown[];
    controllers?: unknown[];
    providers?: unknown[];
    exports?: unknown[];
  }): ClassDecorator;

  export function Get(ruta?: string): MethodDecorator;
  export function Post(ruta?: string): MethodDecorator;
  export function Put(ruta?: string): MethodDecorator;
  export function Patch(ruta?: string): MethodDecorator;
  export function Delete(ruta?: string): MethodDecorator;

  export function Param(nombre?: string): ParameterDecorator;
  export function Query(nombre?: string): ParameterDecorator;
  export function Body(nombre?: string): ParameterDecorator;

  export class HttpException extends Error {
    constructor(respuesta: string | object, estado: number);
  }
  export class NotFoundException extends HttpException {
    constructor(mensaje?: string);
  }
  export class BadRequestException extends HttpException {
    constructor(mensaje?: string);
  }
  export class ConflictException extends HttpException {
    constructor(mensaje?: string);
  }
}

declare module '@nestjs/core' {
  export interface AplicacionNest {
    listen(puerto: number): Promise<void>;
  }
  export const NestFactory: {
    create(modulo: unknown): Promise<AplicacionNest>;
  };
}
`;
