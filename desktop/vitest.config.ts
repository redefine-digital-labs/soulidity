import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: [
      'packages/backend/src/**/*.test.{ts,tsx}',
      'packages/backend/src/**/*.spec.{ts,tsx}',
      'apps/desktop/src/**/*.test.{ts,tsx}',
      'apps/desktop/src/**/*.spec.{ts,tsx}',
    ],
    globals: true
  },
  resolve: {
    alias: {
      '@soulidity/shared': resolve(__dirname, 'packages/shared/src/index.ts')
    }
  }
})
