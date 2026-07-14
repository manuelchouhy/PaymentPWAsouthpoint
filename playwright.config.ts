import { defineConfig, devices } from '@playwright/test'

/**
 * Config de Playwright (Prompt R2). Solo Chromium por ahora; los demás
 * navegadores se suman en una fase posterior. Un solo worker: los tests
 * comparten la misma base (Supabase) y corren contra el mismo servidor
 * de test-mode, así que se evitan condiciones de carrera.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './tests/e2e',
  // 45s: el sync manual dispara la Edge Function real de Zoho (con reintentos).
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        env: { VITE_TEST_MODE: 'true' },
        timeout: 60_000,
      },
})
