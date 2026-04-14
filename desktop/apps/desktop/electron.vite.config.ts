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
    plugins: [react()],
    resolve: {
      alias: {
        '@soulidity/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
    define: {
      'process.env.NEXT_PUBLIC_SUI_NETWORK': JSON.stringify(process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet'),
      'process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID': JSON.stringify(process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID || '0x2'),
    },
  }
})
