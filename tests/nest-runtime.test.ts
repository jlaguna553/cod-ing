import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { NODE_PRELUDE } from '@/lib/runners/node-prelude';
import { NEST_PRELUDE } from '@/lib/runners/nest-prelude';

/**
 * El Nest simulado, compilado con el compilador de verdad.
 *
 * El TypeScript que se usa aquí **es el que usa el navegador**: el que Monaco
 * trae dentro (`typescriptServices.js`, 5.9). No es una aproximación — los
 * decoradores se emiten con los mismos ayudantes `__decorate` y `__metadata`,
 * y por tanto el contenedor de dependencias recibe exactamente los metadatos
 * que recibirá en la pantalla. Sin eso, un test que «pasa» aquí no diría nada
 * sobre lo que hace el alumno.
 *
 * Lo que no se prueba aquí es la comprobación de tipos, que en producción
 * corre en el worker de Monaco: `transpileModule` solo traduce. De eso se
 * encarga `e2e/nest.spec.ts`.
 */

const SERVICIOS = path.resolve(
  import.meta.dirname,
  '../node_modules/monaco-editor/esm/vs/languages/features/typescript/lib/typescriptServices.js',
);

const { typescript: ts } = (await import(SERVICIOS)) as {
  typescript: {
    version: string;
    ModuleKind: { CommonJS: number };
    ScriptTarget: { ES2020: number };
    transpileModule: (
      entrada: string,
      opciones: unknown,
    ) => { outputText: string };
  };
};

function compilar(codigo: string): string {
  return ts.transpileModule(codigo, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    },
  }).outputText;
}

interface Peticion {
  method: string;
  url: string;
  body?: string;
}

/** Compila el proyecto, lo monta como lo monta el runner y devuelve la salida. */
async function ejecutar(
  archivos: Record<string, string>,
  entrada: string,
  peticiones: Peticion[] = [],
): Promise<string> {
  const salida: string[] = [];
  const otros: Record<string, string> = {};

  for (const [ruta, contenido] of Object.entries(archivos)) {
    if (ruta === entrada) continue;
    otros[ruta.replace(/\.ts$/, '.js')] = compilar(contenido);
  }

  const global: Record<string, unknown> = {
    __ARCHIVOS__: otros,
    __PETICIONES__: peticiones,
    console: {
      log: (...args: unknown[]) => salida.push(args.map(String).join(' ')),
      error: (...args: unknown[]) => salida.push(args.map(String).join(' ')),
      warn: () => {},
      info: () => {},
    },
  };

  new Function('window', `with (window) { ${NODE_PRELUDE} ${NEST_PRELUDE} }`)(global);

  /*
   * Los módulos que carga `require` corren en su propio ámbito y ahí `console`
   * es la de verdad. En el navegador da igual —la consola del iframe se
   * captura entera—, pero aquí sus líneas se perderían por la salida del test.
   */
  const original = globalThis.console.log;
  globalThis.console.log = (...args: unknown[]) => salida.push(args.map(String).join(' '));

  try {
    new Function('require', 'process', 'console', 'module', 'exports', compilar(archivos[entrada]))(
      global.require,
      global.process,
      global.console,
      { exports: {} },
      {},
    );
    // El arranque de Nest es asíncrono: se le deja terminar la cadena.
    await new Promise((listo) => setTimeout(listo, 20));
  } finally {
    globalThis.console.log = original;
  }

  return salida.join('\n');
}

/* ── Un proyecto de Nest de manual ───────────────────────────────── */

const SERVICIO = `
import { Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class UsuariosService {
  private usuarios = [
    { id: 1, nombre: 'Ana' },
    { id: 2, nombre: 'Luis' },
  ];

  todos() {
    return this.usuarios;
  }

  uno(id: number) {
    const usuario = this.usuarios.find((u) => u.id === id);
    if (!usuario) throw new NotFoundException('No hay usuario ' + id);
    return usuario;
  }

  crear(nombre: string) {
    const usuario = { id: this.usuarios.length + 1, nombre };
    this.usuarios.push(usuario);
    return usuario;
  }
}
`;

const CONTROLADOR = `
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  todos() {
    return this.usuarios.todos();
  }

  @Get('nuevos')
  nuevos() {
    return { seccion: 'nuevos' };
  }

  @Get(':id')
  uno(@Param('id') id: string) {
    return this.usuarios.uno(Number(id));
  }

  @Post()
  crear(@Body() cuerpo: { nombre: string }) {
    return this.usuarios.crear(cuerpo.nombre);
  }
}
`;

const MODULO = `
import { Module } from '@nestjs/common';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';

@Module({
  controllers: [UsuariosController],
  providers: [UsuariosService],
})
export class AppModule {}
`;

const MAIN = `
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

bootstrap();
`;

const PROYECTO = {
  'main.ts': MAIN,
  'app.module.ts': MODULO,
  'usuarios.controller.ts': CONTROLADOR,
  'usuarios.service.ts': SERVICIO,
};

const PETICIONES: Peticion[] = [
  { method: 'GET', url: '/usuarios' },
  { method: 'GET', url: '/usuarios/nuevos' },
  { method: 'GET', url: '/usuarios/2' },
  { method: 'GET', url: '/usuarios/99' },
  { method: 'POST', url: '/usuarios', body: '{"nombre":"Marta"}' },
  { method: 'GET', url: '/no-existe' },
];

test('⭐ el compilador es el mismo que el del editor', () => {
  assert.match(ts.version, /^5\./);
  assert.equal(typeof ts.transpileModule, 'function');
});

test('⭐ las rutas se mapean y se anuncian como las anuncia Nest', async () => {
  const salida = await ejecutar(PROYECTO, 'main.ts', PETICIONES);

  assert.match(salida, /\[RoutesResolver\] UsuariosController \{\/usuarios\}:/);
  assert.match(salida, /Mapped \{\/usuarios, GET\} route/);
  assert.match(salida, /Mapped \{\/usuarios\/:id, GET\} route/);
  assert.match(salida, /Mapped \{\/usuarios, POST\} route/);
});

test('⭐ el contenedor inyecta el servicio por su tipo, sin que nadie lo pase', async () => {
  const salida = await ejecutar(PROYECTO, 'main.ts', PETICIONES);

  /*
   * Esta es la afirmación central de Nest: el controlador declara
   * `constructor(private usuarios: UsuariosService)` y nunca lo construye
   * nadie a mano. Si los metadatos no llegaran, esto sería `undefined` y la
   * respuesta un 500.
   */
  assert.match(salida, /GET \/usuarios -> 200 \[\{"id":1,"nombre":"Ana"\}/);
});

test('⭐ un parámetro de ruta llega por @Param, y el POST responde 201', async () => {
  const salida = await ejecutar(PROYECTO, 'main.ts', PETICIONES);

  assert.match(salida, /GET \/usuarios\/2 -> 200 \{"id":2,"nombre":"Luis"\}/);
  // 201 sin que nadie lo pida: es de Nest y sorprende la primera vez.
  assert.match(salida, /POST \/usuarios -> 201 \{"id":3,"nombre":"Marta"\}/);
});

test('⭐ gana la primera ruta que encaja: /usuarios/nuevos no se lo come :id', async () => {
  const salida = await ejecutar(PROYECTO, 'main.ts', PETICIONES);

  assert.match(salida, /GET \/usuarios\/nuevos -> 200 \{"seccion":"nuevos"\}/);
});

test('⭐ una excepción de Nest sale con el cuerpo de Nest', async () => {
  const salida = await ejecutar(PROYECTO, 'main.ts', PETICIONES);

  assert.match(
    salida,
    /GET \/usuarios\/99 -> 404 \{"message":"No hay usuario 99","error":"Not Found","statusCode":404\}/,
  );
});

test('⭐ una ruta que no existe contesta el 404 de Nest', async () => {
  const salida = await ejecutar(PROYECTO, 'main.ts', PETICIONES);

  assert.match(salida, /GET \/no-existe -> 404 \{"message":"Cannot GET \/no-existe"/);
});

test('⭐ olvidar el provider da el error de Nest, con su texto', async () => {
  const sinProvider = {
    ...PROYECTO,
    'app.module.ts': MODULO.replace('providers: [UsuariosService],', 'providers: [],'),
  };

  const salida = await ejecutar(sinProvider, 'main.ts', PETICIONES);

  /*
   * Es EL error de Nest. Se reproduce palabra por palabra porque el valor de
   * la lección está en reconocerlo: quien lo ha visto una vez sabe que le
   * falta una línea en `providers`, y quien no, pierde media tarde.
   */
  assert.match(
    salida,
    /Nest can't resolve dependencies of the UsuariosController \(\?\)\. Please make sure that the argument UsuariosService at index \[0\] is available in the AppModule context\./,
  );
});

test('⭐ un proveedor con dependencias y sin @Injectable se dice a la cara', async () => {
  /*
   * Sin decorador, TypeScript no emite los metadatos del constructor: el
   * contenedor ve una clase que no pide nada y la construye con `undefined`
   * dentro. Nest falla mucho mas tarde, al usar la dependencia, y con un
   * mensaje que no señala a ninguna parte. Aqui se dice de una vez.
   */
  const conRepositorio = {
    ...PROYECTO,
    'repositorio.ts': 'export class Repositorio { leer() { return []; } }',
    'usuarios.service.ts': `
import { Repositorio } from './repositorio';

export class UsuariosService {
  constructor(private readonly repositorio: Repositorio) {}
  todos() {
    return this.repositorio.leer();
  }
}
`,
    'app.module.ts': MODULO.replace(
      'providers: [UsuariosService],',
      "providers: [UsuariosService, require('./repositorio').Repositorio],",
    ),
  };

  const salida = await ejecutar(conRepositorio, 'main.ts', PETICIONES);

  assert.match(salida, /Nest can't resolve dependencies of the UsuariosService/);
  assert.match(salida, /Le falta @Injectable\(\)/);
});

test('⭐ un módulo importado solo comparte lo que exporta', async () => {
  const modulos = {
    'main.ts': MAIN,
    'usuarios.service.ts': SERVICIO,
    'usuarios.controller.ts': CONTROLADOR,
    'usuarios.module.ts': `
import { Module } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';

@Module({ providers: [UsuariosService] })
export class UsuariosModule {}
`,
    'app.module.ts': `
import { Module } from '@nestjs/common';
import { UsuariosController } from './usuarios.controller';
import { UsuariosModule } from './usuarios.module';

@Module({ imports: [UsuariosModule], controllers: [UsuariosController] })
export class AppModule {}
`,
  };

  const sinExportar = await ejecutar(modulos, 'main.ts', PETICIONES);
  assert.match(sinExportar, /Nest can't resolve dependencies of the UsuariosController/);

  const conExportar = await ejecutar(
    {
      ...modulos,
      'usuarios.module.ts': modulos['usuarios.module.ts'].replace(
        'providers: [UsuariosService]',
        'providers: [UsuariosService], exports: [UsuariosService]',
      ),
    },
    'main.ts',
    PETICIONES,
  );
  assert.match(conExportar, /GET \/usuarios -> 200 \[\{"id":1,"nombre":"Ana"\}/);
});
