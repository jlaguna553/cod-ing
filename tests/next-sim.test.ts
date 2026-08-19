import assert from 'node:assert/strict';
import test from 'node:test';
import { VirtualFs } from '@/lib/runners/cli-sim/vfs';
import { nextBuild, urlDeArchivo } from '@/lib/runners/cli-sim/next-build';

/**
 * El `next build` simulado (ADR-27).
 *
 * Lo que se prueba es lo que la lección promete: que el árbol de archivos
 * decide las rutas, y que los tres errores que se lleva por delante a todo el
 * que empieza salen **con su texto** y por el motivo correcto.
 */

const LAYOUT = 'export default function RootLayout({ children }) {\n  return <html><body>{children}</body></html>;\n}\n';
const PAGINA = 'export default function Page() {\n  return <h1>Hola</h1>;\n}\n';

const construir = (archivos: Record<string, string>, modo: 'build' | 'dev' = 'build') =>
  nextBuild(new VirtualFs(archivos), modo);

test('⭐ la URL sale del árbol de carpetas', () => {
  assert.equal(urlDeArchivo('app/page.tsx'), '/');
  assert.equal(urlDeArchivo('app/blog/page.tsx'), '/blog');
  assert.equal(urlDeArchivo('app/blog/[slug]/page.tsx'), '/blog/[slug]');
});

test('⭐ una carpeta entre paréntesis agrupa pero no sale en la URL', () => {
  // Es de lo primero que sorprende del App Router: `(marketing)` organiza y
  // comparte layout, y la URL no se entera.
  assert.equal(urlDeArchivo('app/(marketing)/precios/page.tsx'), '/precios');
  assert.equal(urlDeArchivo('app/(app)/page.tsx'), '/');
});

test('⭐ el build lista las rutas encontradas', () => {
  const resultado = construir({
    'app/layout.tsx': LAYOUT,
    'app/page.tsx': PAGINA,
    'app/blog/page.tsx': PAGINA,
  });

  assert.equal(resultado.ok, true, resultado.errores.join('\n'));
  assert.deepEqual(
    resultado.rutas.map((r) => r.url),
    ['/', '/blog'],
  );
  assert.match(resultado.salida.join('\n'), /Compiled successfully/);
});

test('⭐ sin layout raíz no hay build, y lo dice como Next', () => {
  const resultado = construir({ 'app/page.tsx': PAGINA });

  assert.equal(resultado.ok, false);
  // El texto importa: es lo que se busca en un buscador a las once de la noche.
  assert.match(resultado.errores.join('\n'), /doesn't have a root layout/);
  assert.match(resultado.errores.join('\n'), /app\/layout\.tsx/);
});

test('⭐ un hook en un componente de servidor falla con el error de Next', () => {
  const resultado = construir({
    'app/layout.tsx': LAYOUT,
    'app/page.tsx': "import { useState } from 'react';\nexport default function Page() {\n  const [n] = useState(0);\n  return <p>{n}</p>;\n}\n",
  });

  assert.equal(resultado.ok, false);
  const texto = resultado.errores.join('\n');
  assert.match(texto, /only works in a Client Component/);
  assert.match(texto, /use client/);
  assert.match(texto, /useState/);
});

test('⭐ con «use client» ese mismo archivo compila', () => {
  const resultado = construir({
    'app/layout.tsx': LAYOUT,
    'app/page.tsx': "'use client';\nimport { useState } from 'react';\nexport default function Page() {\n  const [n] = useState(0);\n  return <p>{n}</p>;\n}\n",
  });

  assert.equal(resultado.ok, true, resultado.errores.join('\n'));
});

test('⭐ exportar `metadata` desde un componente de cliente está prohibido', () => {
  const resultado = construir({
    'app/layout.tsx': LAYOUT,
    'app/page.tsx': "'use client';\nexport const metadata = { title: 'Hola' };\nexport default function Page() {\n  return <h1>Hola</h1>;\n}\n",
  });

  assert.equal(resultado.ok, false);
  assert.match(resultado.errores.join('\n'), /attempting to export "metadata"/);
});

test('⭐ una ruta con parámetro es dinámica, salvo que declare sus páginas', () => {
  const sinParams = construir({
    'app/layout.tsx': LAYOUT,
    'app/blog/[slug]/page.tsx': PAGINA,
  });
  assert.equal(sinParams.rutas[0].tipo, 'dinamica');

  const conParams = construir({
    'app/layout.tsx': LAYOUT,
    'app/blog/[slug]/page.tsx':
      'export function generateStaticParams() {\n  return [{ slug: "hola" }];\n}\n' + PAGINA,
  });
  // Con `generateStaticParams`, Next sabe de antemano qué páginas existen.
  assert.equal(conParams.rutas[0].tipo, 'estatica');
});

test('un `app/` sin ninguna página no es una aplicación', () => {
  const resultado = construir({ 'app/layout.tsx': LAYOUT });
  assert.equal(resultado.ok, false);
  assert.match(resultado.errores.join('\n'), /Couldn't find any `page` file/);
});

test('`next dev` dice dónde escucha', () => {
  const resultado = construir({ 'app/layout.tsx': LAYOUT, 'app/page.tsx': PAGINA }, 'dev');
  assert.match(resultado.salida.join('\n'), /localhost:3000/);
});
