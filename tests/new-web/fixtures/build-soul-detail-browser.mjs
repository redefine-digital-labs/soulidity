import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const root = process.cwd(), base = path.join(root, 'tests/new-web/fixtures'), out = process.argv[2]
if (!out) throw new Error('Explicit temporary output directory required')
const stubs = path.join(base, 'soul-detail-browser-stubs.tsx')
const wardrobe = process.argv.includes('--wardrobe')
const equipmentPreview = process.argv.includes('--equipment-preview')
const connected = process.argv.includes('--append-connected')
const access = process.argv.includes('--access-success')
const mutation = access || process.argv.includes('--mutation-success')
const sample = mutation ? JSON.parse(await readFile(path.join(out, access ? 'mutation-grant-issue.json' : 'mutation-delete.json'), 'utf8')) : null
const publicEnv = connected ? JSON.parse(await readFile(path.join(out, 'append-fixture.json'), 'utf8')).env : mutation
  ? {NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID:sample.signed.plan.deployment.marketConfigId,
    NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE:sample.signed.plan.deployment.paymentCoinType} : {}
const mocked = new Set(['use-souls', 'use-require-auth', 'use-grant', 'use-paid-access', 'use-soul-access-mutations',
  'use-soul-content-append', 'use-soul-content-mutations', 'soul-cover-image', 'native-wardrobe',
  'agent-grant-recommendations', 'report-modal', 'listing-modals'])
if (connected) { mocked.delete('use-soul-content-append'); mocked.add('auth-provider') }
if (access) { mocked.delete('use-grant'); mocked.delete('use-soul-access-mutations'); mocked.delete('use-paid-access') }
else if (mutation) mocked.delete('use-soul-content-mutations')
await build({entryPoints: [path.join(base, equipmentPreview ? 'equipment-preview-browser.tsx' : wardrobe ? 'wardrobe-browser.tsx' : 'soul-detail-browser.tsx')], outfile: path.join(out, 'main.js'),
  bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: path.join(root, 'web/tsconfig.json'),
  alias: {react: path.join(root, 'node_modules/react'), 'react-dom': path.join(root, 'node_modules/react-dom'),
    '@tanstack/react-query': path.join(root, 'web/node_modules/@tanstack/react-query')},
  define: {'process.env': JSON.stringify(publicEnv), 'process.env.NODE_ENV': '"development"'},
  plugins: [{name: 'read-only-test-boundaries', setup(b) {
    b.onResolve({filter: /.*/}, args => {
      if (equipmentPreview) {
        if (args.path === '@mysten/dapp-kit' || path.basename(args.path) === 'browser-native-artwork')
          return {path: path.join(base, 'equipment-preview-browser.tsx')}
        return
      }
      if(wardrobe){
        if(args.path==='@mysten/dapp-kit' || ['browser-native-equipment','native-original-preview','native-loadouts'].includes(path.basename(args.path)))
          return {path:path.join(base,'wardrobe-browser.tsx')}
        return
      }
      if(access && args.importer.endsWith('/use-soul-access-mutations.ts') &&
        ['browser-content-write-state','soul-access-operation'].includes(path.basename(args.path)))
        return {path:path.join(base,'soul-detail-access-adapter.ts')}
      if (mutation && args.importer.endsWith('/use-soul-content-mutations.ts') &&
        ['browser-content-write-state','content-mutation-transaction'].includes(path.basename(args.path)))
        return {path:path.join(base,'soul-detail-mutation-adapter.ts')}
      if (connected && args.importer.endsWith('/use-soul-content-append.ts') &&
        ['browser-content-write-state', 'browser-content-open', 'content-append-preparation', 'content-append-operation'].includes(path.basename(args.path)))
        return {path: path.join(base, 'soul-detail-append-adapter.ts')}
      if (['@mysten/dapp-kit', 'next/link', 'next/navigation'].includes(args.path) || mocked.has(path.basename(args.path))) return {path: stubs}
      if (args.importer.endsWith('/use-soul-content-read.ts') && ['browser-content-open', 'browser-content-access'].includes(path.basename(args.path))) return {path: stubs}
    })
  }}]})
const require = createRequire(path.join(root, 'web/package.json'))
const css = (await readFile(path.join(root, 'web/app/globals.css'), 'utf8')).replace(/^@import url\([^\n]+\);\n/m, '')
const compiled = await require('postcss')([require('@tailwindcss/postcss')({base: path.join(root, 'web')})]).process(css, {from: path.join(root, 'web/app/globals.css')})
await writeFile(path.join(out, 'style.css'), compiled.css)
await writeFile(path.join(out, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="main.css"><title>${wardrobe ? 'S8 original Wardrobe journey' : 'S3 original content journey'}</title></head><body><div id="root"></div><script src="main.js"></script></body></html>`)
console.log(out)
