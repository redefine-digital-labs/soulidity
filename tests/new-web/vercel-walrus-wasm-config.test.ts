import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(`${repoRoot}/${relativePath}`, 'utf8')) as T
}

describe('Vercel Walrus WASM deployment config', () => {
  it('uses the environment-aware Vercel build gate and still copies the Walrus WASM asset', () => {
    const vercel = readJson<{ buildCommand?: string; framework?: string; outputDirectory?: string; rewrites?: unknown }>('web/vercel.json')
    const webPackage = readJson<{ scripts?: Record<string, string> }>('web/package.json')

    expect(vercel.buildCommand).toBe('npm run build:vercel')
    expect(webPackage.scripts?.['build:vercel']).toBe('node scripts/vercel-build.mjs')
    expect(vercel.framework).toBe('vite')
    expect(vercel.outputDirectory).toBe('dist-spa')
    expect(vercel.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }])
    expect(webPackage.scripts?.build).toBe('vite build')
    expect(webPackage.scripts?.['prisma:migrate:deploy']).toBeUndefined()
    expect(webPackage.scripts?.['prisma:migrate:preflight']).toBeUndefined()
    expect(webPackage.scripts?.prebuild).toBe('node ../scripts/verify-animacraft-render-core.mjs && npm run copy-walrus-wasm')
    expect(webPackage.scripts?.['copy-walrus-wasm']).toBe('node scripts/copy-walrus-wasm.mjs')
  })
})
