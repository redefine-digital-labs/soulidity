import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { config as loadDotEnv } from 'dotenv'

const repoRoot = resolve(__dirname, '../../..')

function loadDesktopBuildEnv() {
  const envFiles = [
    { path: resolve(repoRoot, '.env'), override: false },
    { path: resolve(repoRoot, '.env.local'), override: true },
  ]

  for (const envFile of envFiles) {
    if (!existsSync(envFile.path)) continue
    loadDotEnv({ path: envFile.path, override: envFile.override })
  }
}

function defineEnv(values: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)]),
  )
}

loadDesktopBuildEnv()

const sharedEnvDefines = defineEnv({
  NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID || '',
  NEXT_PUBLIC_SUI_NETWORK: process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet',
  NEXT_PUBLIC_KIOSK_PACKAGE_ID: process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID || '0x2',
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL || '',
  SOULIDITY_WEB_URL: process.env.SOULIDITY_WEB_URL || '',
})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@soulidity/backend', '@soulidity/shared'] })],
    resolve: {
      alias: {
        '@soulidity/backend': resolve(__dirname, '../../packages/backend/src/index.ts'),
        '@soulidity/shared': resolve(__dirname, '../../packages/shared/src/index.ts')
      }
    },
    define: sharedEnvDefines,
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
    define: sharedEnvDefines,
  }
})
