import assert from 'node:assert/strict';
import test from 'node:test';
import { buildModules, resolveSpecifier, rewriteImports, topologicalOrder } from '@/lib/runners/vue-sfc';

/**
 * La compilación de Vue sin bundler (ADR-13).
 *
 * Se prueba en Node porque es donde el fallo se ve: el compilador oficial es el
 * mismo en Node y en el navegador, así que si aquí sale un módulo con la
 * plantilla dentro, en el navegador también.
 */

const FILES = {
  'src/main.js': "import { createApp } from 'vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');\n",
  'src/App.vue': `<script setup>
import { ref, computed } from 'vue';
import Item from './Item.vue';
const items = ref([{ name: 'Teclado' }]);
const total = computed(() => items.value.length);
</script>

<template>
  <p class="total">Total: {{ total }}</p>
  <Item v-for="i in items" :key="i.name" :name="i.name" />
</template>

<style>
.total { color: red; }
</style>
`,
  'src/Item.vue': `<script setup>
defineProps({ name: String });
</script>

<template>
  <li class="item">{{ name }}</li>
</template>
`,
};

test('resuelve rutas relativas y prueba extensiones', () => {
  const available = new Set(['/src/App.vue', '/src/main.js']);
  assert.equal(resolveSpecifier('./App.vue', '/src/main.js', available), '/src/App.vue');
  // Sin extensión: se prueba `.vue` antes que nada.
  assert.equal(resolveSpecifier('./App', '/src/main.js', available), '/src/App.vue');
  assert.equal(resolveSpecifier('../App.vue', '/src/nested/x.js', available), '/src/App.vue');
  // Un paquete no es una ruta relativa: no se toca.
  assert.equal(resolveSpecifier('vue', '/src/main.js', available), null);
});

test('reescribe los imports a marcadores, incluido `vue`', () => {
  const available = new Set(['/src/App.vue']);
  const { code, dependencies } = rewriteImports(
    "import { createApp } from 'vue';\nimport App from './App.vue';\n",
    '/src/main.js',
    available,
  );

  assert.match(code, /from '@@vue@@'/);
  assert.match(code, /from '@@\/src\/App\.vue@@'/);
  assert.deepEqual(dependencies.sort(), ['/src/App.vue', 'vue']);
});

test('un import que no se resuelve se deja intacto', () => {
  const { code } = rewriteImports("import x from './noExiste';\n", '/src/main.js', new Set());
  assert.match(code, /'\.\/noExiste'/);
});

test('las dependencias van antes que quien las usa', () => {
  const graph = new Map([
    ['/src/main.js', ['/src/App.vue']],
    ['/src/App.vue', ['/src/Item.vue']],
    ['/src/Item.vue', []],
  ]);
  const order = topologicalOrder(graph, '/src/main.js');
  assert.ok(order.indexOf('/src/Item.vue') < order.indexOf('/src/App.vue'));
  assert.ok(order.indexOf('/src/App.vue') < order.indexOf('/src/main.js'));
});

test('un ciclo no cuelga ni revienta', () => {
  const graph = new Map([
    ['/a.js', ['/b.js']],
    ['/b.js', ['/a.js']],
  ]);
  const order = topologicalOrder(graph, '/a.js');
  assert.equal(order.length, 2);
});

test('⭐ el SFC se compila con la plantilla dentro, no solo el script', () => {
  // Era exactamente el fallo de Sandpack: compilaba el `<script>` y dejaba el
  // componente sin función de render, así que Vue pintaba un comentario vacío.
  return buildModules(FILES, 'src/main.js', '/* vue */').then(({ modules, entryId }) => {
    assert.equal(entryId, '/src/main.js');

    const app = modules.find((module) => module.id === '/src/App.vue');
    assert.ok(app);

    // La plantilla acaba como render: las llamadas del runtime lo demuestran.
    assert.match(app.code, /_createElementVNode|_createElementBlock/);
    assert.match(app.code, /Total: /);
    // Y el `<style>` viaja: sin esto la lección se ve sin estilos.
    assert.match(app.code, /\.total \{ color: red; \}/);
  });
});

test('⭐ el runtime de Vue va primero y el entry el último', async () => {
  const { modules } = await buildModules(FILES, 'src/main.js', '/* vue */');
  const ids = modules.map((module) => module.id);

  assert.equal(ids[0], 'vue');
  assert.equal(ids.at(-1), '/src/main.js');
  assert.ok(ids.indexOf('/src/Item.vue') < ids.indexOf('/src/App.vue'));
});

test('⭐ ningún módulo conserva un import sin resolver a otro archivo', async () => {
  const { modules } = await buildModules(FILES, 'src/main.js', '/* vue */');

  for (const module of modules.slice(1)) {
    assert.doesNotMatch(
      module.code,
      /from\s+['"]\.\.?\//,
      `${module.id} conserva un import relativo sin reescribir`,
    );
  }
});

test('⭐ arranca por `main.js`, no por el archivo que se edita', async () => {
  const { detectBootstrap } = await import('@/lib/runners/vue');

  // `workspace.entry` en una lección de Vue es el componente que se abre en el
  // editor. Importarlo solo lo define: quien monta la app es `main.js`, así
  // que arrancar por el otro dejaba la pantalla en blanco sin ningún error.
  assert.equal(detectBootstrap(FILES, 'src/App.vue'), '/src/main.js');
  // Sin convención reconocible, se respeta lo que diga la lección.
  assert.equal(detectBootstrap({ 'src/Solo.vue': '' }, 'src/Solo.vue'), '/src/Solo.vue');
});
