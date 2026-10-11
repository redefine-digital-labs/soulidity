import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { spaBrowserBoundary } from './spa/build-boundary'
import { staticPublicEnvironment } from './spa/public-env'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode, command }) => {
  // Same repository environment location as Next, but only explicit public
  // keys are injected. Never serialize the host process.env or server secrets.
  const env = staticPublicEnvironment(process.env, () => loadEnv(mode, resolve(root, '..'), 'NEXT_PUBLIC_'))
  const wasm = JSON.parse(readFileSync(resolve(root, 'node_modules/@mysten/walrus-wasm/package.json'), 'utf8'))
  const publicEnv = { ...env, NEXT_PUBLIC_WALRUS_WASM_VERSION: wasm.version,
    NODE_ENV: command === 'build' ? 'production' : 'development' }
  return {
    root, base: '/', appType: 'spa', publicDir: 'public', envPrefix: 'NEXT_PUBLIC_', envDir: false,
    define: { 'process.env': JSON.stringify(publicEnv) },
    plugins: [spaBrowserBoundary(root)],
    resolve: { dedupe: ['react', 'react-dom'], alias: [
      { find: /^next\/navigation$/, replacement: resolve(root, 'spa/navigation.tsx') },
      { find: /^next\/link$/, replacement: resolve(root, 'spa/link.tsx') },
      { find: /^next\/image$/, replacement: resolve(root, 'spa/image.tsx') },
      { find: /^@\//, replacement: root + '/' },
      { find: /^@lib\//, replacement: root + '/lib/' },
      { find: /^@web\//, replacement: root + '/' },
      { find: /^@shared\//, replacement: resolve(root, '../src/shared') + '/' },
      { find: /^@bot\//, replacement: resolve(root, '../src/bot') + '/' },
      { find: /^@db\//, replacement: resolve(root, '../src/db') + '/' },
    ] },
    build: { outDir: 'dist-spa', emptyOutDir: false, target: 'es2022' },
  }
})
