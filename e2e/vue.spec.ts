import { expect, test, type Page } from '@playwright/test';

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

  await page.locator('.monaco-editor .view-lines').click();
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

  await page.locator('.monaco-editor .view-lines').click();
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
