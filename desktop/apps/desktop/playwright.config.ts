import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const rootDir = dirname(fileURLToPath(import.meta.url))

/**
 * Electron-targeted Playwright config. Only the `sprite-flow` spec runs here
 * for now — it drives `electron.launch` via the built `out/main/index.js`.
 * Run: `pnpm --filter @soulidity/desktop run e2e` (build must have completed).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-sprite-flow',
      testMatch: /.*sprite-flow\.spec\.ts/,
      use: {
        launchOptions: {
          // Electron entry relative to repo root. The spec file builds on this
          // via _electron.launch; this field is informational for debugging.
          cwd: rootDir,
        },
      },
    },
  ],
})
