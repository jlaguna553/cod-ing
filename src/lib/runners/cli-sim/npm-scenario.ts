import type { VirtualFs } from './vfs';

/**
 * Andamiaje de proyectos, equivalente a lo que escribe `npm create vite`.
 *
 * Los archivos son reales y ejecutables: el mismo `src/main.jsx` que se genera
 * aquí es el que Sandpack monta en el preview. Esa es la diferencia entre una
 * terminal decorativa y una que de verdad construye el proyecto — el usuario
 * teclea el comando, ve aparecer el árbol, abre un archivo y lo edita.
 *
 * Lo que NO se puede hacer, y conviene tenerlo claro: instalar un paquete
 * arbitrario de npm. Solo existen las plantillas que definimos. Para una
 * lección guiada donde el objetivo es aprender el comando y la estructura,
 * alcanza; para "instala lo que quieras" haría falta un Node real (ADR-07).
 */
export const VITE_TEMPLATES = ['react', 'vue', 'vanilla'] as const;

export type Template = (typeof VITE_TEMPLATES)[number];

/** Estrecha un string arbitrario del usuario a una plantilla conocida. */
export function isTemplate(value: string): value is Template {
  return (VITE_TEMPLATES as readonly string[]).includes(value);
}

const SHARED = {
  '.gitignore': 'node_modules\ndist\n.env\n',
  'index.html': `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
  'vite.config.js': `import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
});
`,
};

const TEMPLATES: Record<Template, Record<string, string>> = {
  react: {
    ...SHARED,
    'package.json': JSON.stringify(
      {
        name: 'vite-react-app',
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: { vite: '^5.4.0', '@vitejs/plugin-react': '^4.3.0' },
      },
      null,
      2,
    ),
    'src/main.jsx': `import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(<App />);
`,
    'src/App.jsx': `export default function App() {
  return (
    <main>
      <h1>Vite + React</h1>
      <p>Edita <code>src/App.jsx</code> y guarda para ver los cambios.</p>
    </main>
  );
}
`,
    'src/index.css': `body {
  font-family: system-ui, sans-serif;
  margin: 0;
  padding: 2rem;
}
`,
  },

  vue: {
    ...SHARED,
    'index.html': SHARED['index.html'].replace('/src/main.jsx', '/src/main.js'),
    'package.json': JSON.stringify(
      {
        name: 'vite-vue-app',
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { vue: '^3.5.0' },
        devDependencies: { vite: '^5.4.0', '@vitejs/plugin-vue': '^5.1.0' },
      },
      null,
      2,
    ),
    'src/main.js': `import { createApp } from 'vue';
import App from './App.vue';
import './index.css';

createApp(App).mount('#root');
`,
    'src/App.vue': `<script setup>
import { ref } from 'vue';

const message = ref('Vite + Vue');
</script>

<template>
  <main>
    <h1>{{ message }}</h1>
    <p>Edita <code>src/App.vue</code> y guarda para ver los cambios.</p>
  </main>
</template>
`,
    'src/index.css': `body {
  font-family: system-ui, sans-serif;
  margin: 0;
  padding: 2rem;
}
`,
  },

  vanilla: {
    ...SHARED,
    'index.html': SHARED['index.html'].replace('/src/main.jsx', '/src/main.js'),
    'package.json': JSON.stringify(
      {
        name: 'vite-vanilla-app',
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        devDependencies: { vite: '^5.4.0' },
      },
      null,
      2,
    ),
    'src/main.js': `document.querySelector('#root').innerHTML = '<h1>Vite</h1>';
`,
  },
};

/** Escribe la plantilla bajo `base` y devuelve las rutas creadas. */
export function scaffoldVite(fs: VirtualFs, base: string, template: Template): string[] {
  const files = TEMPLATES[template];
  if (!files) return [];

  const created: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    const full = base === '' ? path : `${base}/${path}`;
    fs.write(full, content);
    created.push(full);
  }
  return created.sort();
}
