import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../../web/scripts/vercel-build.mjs', import.meta.url))

function plan(env: Record<string, string>) {
  const output = execFileSync(process.execPath, [script, '--print-plan'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      ...env,
    },
  })
  return JSON.parse(output.trim()) as string[]
}

describe('Vercel build plan', () => {
  it('builds previews without mutating the production database', () => {
    expect(plan({ VERCEL_ENV: 'preview' })).toEqual(['build'])
  })

  it('runs migrations before a production build', () => {
    expect(plan({
      VERCEL_ENV: 'production',
      DIRECT_URL: 'postgresql://production.example/soulidity',
    })).toEqual(['prisma:migrate:deploy', 'build'])
  })

  it('fails closed when a production build has no database URL', () => {
    expect(() => plan({ VERCEL_ENV: 'production' }))
      .toThrow(/Production Vercel builds require DIRECT_URL or DATABASE_URL/)
  })
})
