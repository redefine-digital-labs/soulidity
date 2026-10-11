import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { readFile, writeFile, copyFile, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
const root = process.cwd(), base = path.join(root, 'tests/new-web/fixtures')
const out = process.argv[2] || await mkdtemp(path.join(os.tmpdir(), 's3-original-controls-'))
const recoveryMode = process.argv.includes('--recovery-export') || process.argv.includes('--paid-recovery')
const mocked = new Set(['use-wallet-sign', 'use-collection-buy', 'client-upload', 'walrus-batch-store', 'browser-content-open',
  'soul-authoring-store', 'soul-authoring-preparation', 'soul-authoring-journal', 'soul-authoring-wallet', 'soul-authoring-kiosk',
  'soul-authoring-completion', 'auth-provider', 'create-soul-provider', 'create-collection-provider', 'import-soul-provider', 'wrap-provider', 'use-kiosk-nfts', 'use-login', 'use-wallet-balances', 'toast'])
if (process.argv.includes('--collection-entry')) mocked.delete('create-collection-provider')
if (recoveryMode) {
  for (const name of ['soul-authoring-store', 'soul-authoring-journal', 'walrus-batch-store']) mocked.delete(name)
  for (const name of ['use-collections', 'collection-listing-modals']) mocked.add(name)
}
if (process.argv.includes('--paid-recovery')) mocked.delete('soul-authoring-wallet')
if (process.argv.includes('--draft-failure')) mocked.add('collection-draft-store')
if (process.argv.includes('--add-soul')) {
  mocked.delete('create-soul-provider')
  for (const name of ['use-collections', 'collection-listing-modals']) mocked.add(name)
}
await build({ entryPoints: [path.join(base, 'ordinary-create-browser.tsx')], outfile: path.join(out, 'main.js'), bundle: true,
  platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: path.join(root, 'web/tsconfig.json'),
  alias: { react: path.join(root, 'node_modules/react'), 'react-dom': path.join(root, 'node_modules/react-dom'),
    '@tanstack/react-query': path.join(root, 'web/node_modules/@tanstack/react-query') },
  define: { ...(process.argv.includes('--paid-recovery') ? { 'import.meta.url': 'location.href' } : {}),
    'process.env': JSON.stringify({ NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID: '0x' + (recoveryMode ? '10' : '8').padStart(64, '0'),
    NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID: '0x' + (recoveryMode ? '11' : '9').padStart(64, '0') }), 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID': JSON.stringify('0x' + (recoveryMode ? '10' : '8').padStart(64, '0')),
    'process.env.NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID': JSON.stringify('0x' + (recoveryMode ? '11' : '9').padStart(64, '0')), 'process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL': JSON.stringify(recoveryMode ? 'https://aggregator.example.com' : '') },
  plugins: [{ name: 'test-only-transports', setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      if (process.argv.includes('--add-soul') && args.path === '@soulidity/sdk' && args.importer.endsWith('/use-publish.ts'))
        return { path: path.join(base, 'add-soul-preflight-stub.ts') }
      if (['next/link', 'next/navigation', '@mysten/dapp-kit'].includes(args.path)
        || /(?:use-collection-draft\.ts|use-publish\.ts|collections\/\[id\]\/page\.tsx|collections\/create\/(?:(?:souls|preview|success)\/)?page\.tsx|(?:create|import)\/(?:(?:content|preview|gas|success)\/)?page\.tsx|wrap-link\/personal\/(?:(?:preview|success|configure)\/)?page\.tsx)$/.test(args.importer) && mocked.has(path.basename(args.path)))
        return { path: path.join(base, 'ordinary-create-browser-stubs.tsx') }
    })
  } }] })
const require = createRequire(path.join(root, 'web/package.json'))
const postcss = require('postcss'), tailwind = require('@tailwindcss/postcss')
const css = (await readFile(path.join(root, 'web/app/globals.css'), 'utf8')).replace(/^@import url\([^\n]+\);\n/m, '')
const compiled = await postcss([tailwind({ base: path.join(root, 'web') })]).process(css, { from: path.join(root, 'web/app/globals.css') })
await writeFile(path.join(out, 'style.css'), compiled.css)
await copyFile(path.join(base, 'ordinary-create-browser.html'), path.join(out, 'index.html'))
if (process.argv.includes('--paid-recovery')) await copyFile(path.join(root, 'web/node_modules/@mysten/walrus-wasm/web/walrus_wasm_bg.wasm'), path.join(out, 'walrus_wasm_bg.wasm'))
console.log(out)
