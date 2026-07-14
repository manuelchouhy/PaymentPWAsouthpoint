import { defineConfig, devices } from '@playwright/test'

/**
 * Config separada para los snapshots visuales del rediseño de UI (prompt
 * post-R2). No comparte testDir con playwright.config.ts: baseline/after
 * son capturas de referencia, no aserciones — no tiene sentido que
 * `npm run test:e2e` las ejecute en cada corrida funcional.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './tests/visual',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
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
