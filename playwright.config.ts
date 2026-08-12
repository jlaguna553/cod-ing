import { defineConfig, devices } from '@playwright/test';

const PORT = 3210;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: `http://localhost:${PORT}`,
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Se prueba contra el build de producción, no contra `next dev`: es el
  // único que ejercita el prerenderizado y el recorte del payload.
  webServer: {
    command: `npx next start -p ${PORT}`,
    // El guardia de `session.ts` se niega a firmar cookies con una clave
    // conocida en producción, y el E2E corre contra un build de producción.
    env: {
      SESSION_SECRET: 'e2e-only-secret-not-for-production',
      // El E2E corre contra un build de producción y no tiene Postgres: se
      // permite PGlite explícitamente. En un despliegue real la ausencia de
      // `DATABASE_URL` debe seguir siendo un error.
      ALLOW_PGLITE_IN_PRODUCTION: '1',
      // Base en memoria: cada arranque parte limpio y los tests no dependen
      // del estado que dejó la ejecución anterior.
      PGLITE_DATA_DIR: '',
    },
    port: PORT,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
