import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: [
      'packages/backend/src/**/*.test.ts',
      'apps/desktop/src/**/*.test.ts',
    ],
    globals: true
  },
  resolve: {
    alias: {
      '@soulidity/shared': resolve(__dirname, 'packages/shared/src/index.ts')
    }
  }
})
