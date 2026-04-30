import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(`${repoRoot}/${relativePath}`, 'utf8')) as T
}

describe('Vercel Walrus WASM deployment config', () => {
  it('runs Prisma migrations before the Vercel web build and still copies the Walrus WASM asset', () => {
    const vercel = readJson<{ buildCommand?: string }>('web/vercel.json')
    const webPackage = readJson<{ scripts?: Record<string, string> }>('web/package.json')

    expect(vercel.buildCommand).toBe('npm run build:vercel')
    expect(webPackage.scripts?.['build:vercel']).toBe('npm run prisma:migrate:deploy && npm run build')
    expect(webPackage.scripts?.['prisma:migrate:deploy']).toBe(
      'cd .. && prisma migrate deploy --schema=prisma/schema.prisma',
    )
    expect(webPackage.scripts?.prebuild).toBe('npm run copy-walrus-wasm')
    expect(webPackage.scripts?.['copy-walrus-wasm']).toBe('node scripts/copy-walrus-wasm.mjs')
  })
})
