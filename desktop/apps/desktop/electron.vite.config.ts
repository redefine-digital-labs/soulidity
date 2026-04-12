import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@soulidity/backend', '@soulidity/shared'] })],
    resolve: {
      alias: {
        '@soulidity/backend': resolve(__dirname, '../../packages/backend/src/index.ts'),
        '@soulidity/shared': resolve(__dirname, '../../packages/shared/src/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
