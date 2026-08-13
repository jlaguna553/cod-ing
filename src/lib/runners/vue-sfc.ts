/**
 * Vue sin bundler y sin servicio de terceros (ADR-13).
 *
 * Sandpack no compila la plantilla de un SFC de Vue 3 con ninguna de sus
 * plantillas, y su bundler vive en un dominio ajeno. Aquí se hace lo mismo por
 * dentro: se compila cada `.vue` con el compilador oficial —que corre en el
 * navegador— y se monta el grafo de módulos a mano sobre `import()` nativo.
 *
 * Todo lo que hace falta viaja en el documento: el runtime de Vue son 168 KB
 * que se sirven desde nuestro propio origen. Cero red en tiempo de ejecución,
 * cero dependencia de un servicio, cero coste.
 *
 * Este módulo es **puro a propósito**: recibe archivos y devuelve texto. Así se
 * prueba en Node, que es donde de verdad se puede comprobar que la compilación
 * y la resolución de rutas hacen lo que dicen.
 */

export interface CompiledModule {
  /** Ruta absoluta dentro del workspace, o `vue` para el runtime. */
  id: string;
  /** Código ya reescrito: cada import apunta a `@@id@@`. */
  code: string;
}

/** Extensiones que se prueban al resolver un import sin extensión. */
const EXTENSIONS = ['', '.vue', '.js', '.mjs', '.jsx', '.ts'];

/** Normaliza a ruta absoluta con una sola barra inicial. */
function absolute(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

/** Resuelve `./Foo.vue` desde `/src/main.js` a `/src/Foo.vue`. */
export function resolveSpecifier(
  specifier: string,
  fromPath: string,
  available: Set<string>,
): string | null {
  if (!specifier.startsWith('.')) return null;

  const segments = `${dirname(absolute(fromPath))}/${specifier}`.split('/');
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') stack.pop();
    else stack.push(segment);
  }
  const base = `/${stack.join('/')}`;

  for (const extension of EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (available.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Reescribe los especificadores a marcadores `@@id@@`.
 *
 * El marcador se sustituye por la URL del blob **dentro del iframe**, cuando
 * ese módulo ya existe. Es lo que permite montar el grafo sin un import map:
 * los blobs se crean en orden de dependencia y cada uno ya conoce las URLs de
 * los anteriores.
 */
export function rewriteImports(
  code: string,
  fromPath: string,
  available: Set<string>,
): { code: string; dependencies: string[] } {
  const dependencies = new Set<string>();

  const rewritten = code.replace(
    /(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\2/g,
    (match, prefix: string, quote: string, specifier: string) => {
      if (specifier === 'vue' || specifier.startsWith('vue/')) {
        dependencies.add('vue');
        return `${prefix}${quote}@@vue@@${quote}`;
      }
      const resolved = resolveSpecifier(specifier, fromPath, available);
      if (!resolved) return match;
      dependencies.add(resolved);
      return `${prefix}${quote}@@${resolved}@@${quote}`;
    },
  );

  return { code: rewritten, dependencies: [...dependencies] };
}

/** Compila un SFC a un módulo ES con la plantilla ya dentro del `setup`. */
export async function compileSfc(path: string, source: string): Promise<string> {
  /*
   * La ruta explícita al build de navegador, no `@vue/compiler-sfc` a secas.
   *
   * El paquete expone una condición `node` que apunta a su build CJS, y el
   * bundler la prefiere: eso arrastra `consolidate` con sus treinta motores de
   * plantillas y el build revienta con 43 módulos sin resolver (`atpl`,
   * `babel-core`…). El ESM de navegador no tiene nada de eso.
   */
  const { parse, compileScript } = await import(
    '@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js'
  );

  const { descriptor, errors } = parse(source, { filename: path });
  if (errors.length > 0) {
    throw new Error(`${path}: ${errors[0].message}`);
  }

  /*
   * `id` alimenta el hash del ámbito de los estilos. Se deriva de la ruta para
   * que sea estable entre ejecuciones: con un id aleatorio, cada compilación
   * generaría un módulo distinto aunque el archivo no hubiera cambiado.
   */
  const id = path.replace(/[^a-z0-9]/gi, '').slice(-16) || 'lesson';

  const script = compileScript(descriptor, { id, inlineTemplate: true });
  let code = script.content;

  // Los estilos del SFC no los aplica nadie: se inyectan al montar.
  const styles = descriptor.styles.map((style) => style.content).join('\n').trim();
  if (styles !== '') {
    code += `\n;(function () {
  var style = document.createElement('style');
  style.textContent = ${JSON.stringify(styles)};
  document.head.appendChild(style);
})();\n`;
  }

  return code;
}

/**
 * Ordena los módulos para que cada uno se cree después de sus dependencias.
 *
 * Un ciclo no es un error del usuario que merezca reventar: se rompe dejando
 * el módulo donde toque y el `import()` nativo se encarga del resto.
 */
export function topologicalOrder(
  graph: Map<string, string[]>,
  entry: string,
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();

  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const dependency of graph.get(id) ?? []) visit(dependency);
    order.push(id);
  };

  visit(entry);
  // Lo que no cuelga del entry se añade igual: puede tener efectos.
  for (const id of graph.keys()) visit(id);

  return order;
}

/**
 * Prepara los módulos de la lección, ya compilados y reescritos.
 *
 * `vueRuntime` es el contenido del build de navegador de Vue, que el runner
 * lee una vez de nuestro propio origen y reutiliza en cada ejecución.
 */
export async function buildModules(
  files: Record<string, string>,
  entry: string,
  vueRuntime: string,
): Promise<{ modules: CompiledModule[]; entryId: string }> {
  const normalized = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) {
    normalized.set(absolute(path), content);
  }

  const available = new Set(normalized.keys());
  const entryId = absolute(entry);

  const compiled = new Map<string, string>();
  for (const [path, content] of normalized) {
    if (!/\.(vue|js|mjs|jsx|ts)$/.test(path)) continue;
    compiled.set(path, path.endsWith('.vue') ? await compileSfc(path, content) : content);
  }

  const graph = new Map<string, string[]>();
  const rewritten = new Map<string, string>();
  for (const [path, code] of compiled) {
    const result = rewriteImports(code, path, available);
    rewritten.set(path, result.code);
    graph.set(path, result.dependencies);
  }

  const order = topologicalOrder(graph, entryId).filter((id) => rewritten.has(id));

  return {
    entryId,
    modules: [
      { id: 'vue', code: vueRuntime },
      ...order.map((id) => ({ id, code: rewritten.get(id) ?? '' })),
    ],
  };
}
