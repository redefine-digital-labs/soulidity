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

  it('never runs database operations even if historical credentials are present', () => {
    expect(plan({
      VERCEL_ENV: 'production',
      DIRECT_URL: 'postgresql://production.example/soulidity',
    })).toEqual(['build'])
  })

  it('builds production with no database credentials', () => {
    expect(plan({ VERCEL_ENV: 'production' })).toEqual(['build'])
  })
})
