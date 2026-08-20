import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { codigo } from './pasos';

/**
 * Vue sin bundler ni terceros (ADR-13).
 *
 * Es el test que justifica el runner entero: Sandpack compilaba el `<script>`
 * del SFC y no la plantilla, así que Vue montaba y pintaba un comentario
 * vacío. Aquí se comprueba lo contrario — que la plantilla llega renderizada y
 * que el evaluador puede leerla.
 */

/** Texto que el evaluador ve, a través del espejo del ADR-10. */
async function mirrorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const mirror = Array.from(document.querySelectorAll('iframe')).find(
      (frame) => frame.getAttribute('sandbox') === 'allow-same-origin',
    );
    return mirror?.contentDocument?.body?.innerText ?? '';
  });
}

async function waitForEditor(page: Page) {
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await expect(page.locator('.view-lines')).not.toBeEmpty({ timeout: 20_000 });
}

test('⭐ un SFC de Vue renderiza su plantilla, no un comentario vacío', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/es/play/frontend/vue-01-template-syntax');
  await waitForEditor(page);

  await page.getByRole('button', { name: /ejecutar/i }).click();

  // El código de partida ya pinta texto literal: si la plantilla no se
  // compilara, no habría absolutamente nada.
  await expect.poll(() => mirrorText(page), { timeout: 60_000 }).toContain('NOMBRE');
});

test('⭐ la lista y las directivas funcionan con la solución', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/es/play/frontend/vue-01-template-syntax');
  await waitForEditor(page);

  await page.locator('.monaco-editor').click({ position: { x: 100, y: 40 } });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    `<script setup>
const player = { name: 'Ada', level: 7, avatar: 'https://placehold.co/64', online: true };
const quests = [
  { id: 1, title: 'Aprender directivas', done: true },
  { id: 2, title: 'Dominar v-for', done: false },
];
</script>

<template>
  <section class="profile">
    <h1>{{ player.name }}</h1>
    <p class="status" v-if="player.online">En línea</p>
    <ul class="quests">
      <li v-for="quest in quests" :key="quest.id">{{ quest.title }}</li>
    </ul>
  </section>
</template>
`,
  );

  await page.getByRole('button', { name: /ejecutar/i }).click();

  // Interpolación, `v-if` y `v-for`: las tres piezas de la lección.
  const text = expect.poll(() => mirrorText(page), { timeout: 60_000 });
  await text.toContain('Ada');
  await expect.poll(() => mirrorText(page)).toContain('En línea');
  await expect.poll(() => mirrorText(page)).toContain('Dominar v-for');
});

test('⭐ un error de compilación se enseña en vez de dejar la pantalla en blanco', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/es/play/frontend/vue-01-template-syntax');
  await waitForEditor(page);

  await page.locator('.monaco-editor').click({ position: { x: 100, y: 40 } });
  await page.keyboard.press('ControlOrMeta+a');
  // Un error de sintaxis en el `<script setup>`: el compilador sí lo rechaza.
  // (Una plantilla mal cerrada Vue la tolera y la arregla, como el navegador.)
  await page.keyboard.insertText(
    '<script setup>\nconst roto = ;\n</script>\n\n<template>\n  <p>hola</p>\n</template>\n',
  );

  await page.getByRole('button', { name: /ejecutar/i }).click();
  await page.getByRole('button', { name: /consola/i }).click();
  // El mensaje del compilador, con archivo y línea señalada — no una pantalla
  // en blanco ni un «algo falló».
  const consola = page.getByRole('log', { name: /consola/i });
  await expect(consola).toContainText('vue/compiler-sfc', { timeout: 30_000 });
  await expect(consola).toContainText('/src/App.vue');
  await expect(consola).toContainText('const roto');
});

test('⭐ vue-04: los tres pasos de la lista de tareas renderizan lo prometido', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/es/play/frontend/vue-04-todo-list');
  await waitForEditor(page);

  const write = async (code: string) => {
    await page.locator('.monaco-editor').click({ position: { x: 100, y: 40 } });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(code);
    await page.getByRole('button', { name: /ejecutar/i }).click();
  };

  const SCRIPT = `<script setup>
import { ref, computed } from 'vue';
const tareas = ref([
  { id: 1, texto: 'Aprender v-for', hecha: true },
  { id: 2, texto: 'Dominar computed', hecha: false },
  { id: 3, texto: 'Vencer al boss', hecha: false },
]);
const filtro = ref('pendientes');
const pendientes = computed(() => tareas.value.filter((t) => !t.hecha).length);
const visibles = computed(() =>
  filtro.value === 'pendientes' ? tareas.value.filter((t) => !t.hecha) : tareas.value,
);
</script>
`;

  const list = (source: string) => `${SCRIPT}
<template>
  <p class="pendientes">Quedan {{ pendientes }}</p>
  <ul>
    <li v-for="tarea in ${source}" :key="tarea.id" class="tarea" :class="{ hecha: tarea.hecha }">
      {{ tarea.texto }}
    </li>
  </ul>
</template>
`;

  // Paso 1 y 2: las tres tareas, una tachada, y el recuento calculado.
  await write(list('tareas'));
  await expect.poll(() => mirrorText(page), { timeout: 60_000 }).toContain('Quedan 2');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const mirror = Array.from(document.querySelectorAll('iframe')).find(
          (frame) => frame.getAttribute('sandbox') === 'allow-same-origin',
        );
        const doc = mirror?.contentDocument;
        return `${doc?.querySelectorAll('li.tarea').length}/${doc?.querySelectorAll('li.hecha').length}`;
      }),
    )
    .toBe('3/1');

  // Paso 3: el filtro deja dos a la vista sin tocar el origen.
  await write(list('visibles'));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const mirror = Array.from(document.querySelectorAll('iframe')).find(
          (frame) => frame.getAttribute('sandbox') === 'allow-same-origin',
        );
        return mirror?.contentDocument?.querySelectorAll('li.tarea').length ?? -1;
      }),
      { timeout: 60_000 },
    )
    .toBe(2);
  // El recuento sigue diciendo 2: la lista original conserva las tres.
  await expect.poll(() => mirrorText(page)).toContain('Quedan 2');
});

test('⭐ vue-05: las cuentas que promete la lección son las que salen', async ({ page }) => {
  test.setTimeout(180_000);

  // Se leen las soluciones REALES del JSON: si alguien las cambia y dejan de
  // producir 9, 6 y `y: 3`, este test lo dice. Copiarlas aquí no probaría nada.
  const lesson = JSON.parse(
    readFileSync('content/lessons/frontend/vue/vue-05-word-count.lesson.json', 'utf8'),
  ) as {
    steps: Array<{ id: string; solution?: Array<{ path: string; content: string }> }>;
  };
  const solutionOf = (id: string) =>
    codigo(lesson.steps.find((step) => step.id === id)?.solution?.[0]?.content ?? '');

  await page.goto('/es/play/frontend/vue-05-word-count');
  await waitForEditor(page);

  const countWords = () =>
    page.evaluate(() => {
      const mirror = Array.from(document.querySelectorAll('iframe')).find(
        (frame) => frame.getAttribute('sandbox') === 'allow-same-origin',
      );
      const items = mirror?.contentDocument?.querySelectorAll('li.palabra');
      return {
        total: items?.length ?? -1,
        first: items?.[0]?.textContent?.trim() ?? '',
      };
    });

  const run = async (code: string) => {
    await page.locator('.monaco-editor').click({ position: { x: 100, y: 40 } });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(code);
    await page.getByRole('button', { name: /ejecutar/i }).click();
  };

  // Paso 1: sin normalizar, diez palabras dan nueve entradas.
  await run(solutionOf('step-1-naive'));
  await expect.poll(countWords, { timeout: 60_000 }).toMatchObject({ total: 9 });

  // Paso 2: normalizando, seis.
  await run(solutionOf('step-2-normalize'));
  await expect.poll(countWords, { timeout: 60_000 }).toMatchObject({ total: 6 });

  // Paso 3: ordenado, la más frecuente encabeza.
  await run(solutionOf('step-3-sort'));
  await expect.poll(countWords, { timeout: 60_000 }).toMatchObject({ total: 6, first: 'y: 3' });
});
