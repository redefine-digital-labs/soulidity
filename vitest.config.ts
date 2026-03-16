import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@bot': fileURLToPath(new URL('./src/bot', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@web': fileURLToPath(new URL('./web', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
})
