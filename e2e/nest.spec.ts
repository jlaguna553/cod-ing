import { expect, test, type Page } from '@playwright/test';
import { abrirArchivo, escribirEnEditor, solucionDelPaso } from './pasos';

/**
 * NestJS sobre el Node simulado (ADR-28).
 *
 * El contenedor y el enrutado se prueban en `tests/nest-runtime.test.ts`, con
 * el mismo compilador que hay aquí dentro. Lo que sólo se puede comprobar en
 * el navegador es lo otro: que el worker de TypeScript de Monaco acepta los
 * decoradores, emite sus metadatos y que la lección se supera en pantalla.
 */

const LECCIONES = [
  'nest-01-controlador-y-modulo',
  'nest-02-inyeccion-de-dependencias',
  'nest-03-parametros-y-errores',
] as const;

async function waitForEditor(page: Page) {
  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await expect(page.locator('.view-lines')).not.toBeEmpty({ timeout: 20_000 });
}

const consola = (page: Page) => page.getByRole('log', { name: /consola/i });

async function aplicar(page: Page, archivos: Array<{ path: string; content: string }>) {
  for (const archivo of archivos) {
    await abrirArchivo(page, archivo.path);
    await escribirEnEditor(page, archivo.content);
  }
}

test('⭐ los decoradores compilan y el contenedor inyecta por el tipo', async ({ page }) => {
  await page.goto('/es/play/backend/nest-01-controlador-y-modulo');
  await waitForEditor(page);

  await aplicar(page, [
    {
      path: 'usuarios.controller.ts',
      content:
        "import { Controller, Get } from '@nestjs/common';\n\n@Controller('usuarios')\nexport class UsuariosController {\n  @Get()\n  todos() {\n    return [{ id: 1, nombre: 'Ana' }];\n  }\n}\n",
    },
    {
      path: 'app.module.ts',
      content:
        "import { Module } from '@nestjs/common';\nimport { UsuariosController } from './usuarios.controller';\n\n@Module({\n  controllers: [UsuariosController],\n  providers: [],\n})\nexport class AppModule {}\n",
    },
  ]);

  await page.getByRole('button', { name: /ejecutar/i }).click();

  // Las líneas de arranque de Nest, y la respuesta de la petición declarada.
  await expect(consola(page)).toContainText('Mapped {/usuarios, GET} route', { timeout: 60_000 });
  await expect(consola(page)).toContainText('GET /usuarios -> 200 [{"id":1,"nombre":"Ana"}]');
  // Lo que nadie mapeó no existe.
  await expect(consola(page)).toContainText('Cannot GET /pedidos');
});

test('⭐ un error de tipos para la ejecución antes de arrancar Nest', async ({ page }) => {
  await page.goto('/es/play/backend/nest-01-controlador-y-modulo');
  await waitForEditor(page);

  await aplicar(page, [
    {
      path: 'usuarios.controller.ts',
      content:
        "import { Controller, Get } from '@nestjs/common';\n\n@Controller('usuarios')\nexport class UsuariosController {\n  @Get()\n  todos(): string {\n    return [{ id: 1, nombre: 'Ana' }];\n  }\n}\n",
    },
  ]);

  await page.getByRole('button', { name: /ejecutar/i }).click();

  // El compilador es el del editor: el error que juzga es el que está subrayado.
  await expect(consola(page)).toContainText('error TS2322', { timeout: 60_000 });
  await expect(consola(page)).not.toContainText('Nest application successfully started');
});

for (const leccion of LECCIONES) {
  test(`⭐ ${leccion}: cada paso se supera con su solución`, async ({ page }) => {
    test.setTimeout(240_000);

    await page.goto(`/es/play/backend/${leccion}`);
    await waitForEditor(page);

    for (let paso = 0; paso < 3; paso++) {
      await aplicar(page, solucionDelPaso(leccion, paso));
      await page.getByRole('button', { name: /^evaluar$/i }).click();

      await expect(
        page.getByText(/todas las pruebas superadas/i),
        `el paso ${paso + 1} de ${leccion} no pasa con su propia solución`,
      ).toBeVisible({ timeout: 90_000 });

      if (paso < 2) {
        await page.getByRole('button', { name: /^siguiente$/i }).click();
        await expect(
          page.locator('[data-widget="challenge"]').getByText(`Paso ${paso + 2} de 3`),
        ).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(600);
      }
    }
  });
}

test('⭐ el módulo de Nest aparece en la ruta de Backend', async ({ page }) => {
  await page.goto('/es/tracks/backend');
  await expect(page.getByRole('heading', { name: 'nest' })).toBeVisible();
});
