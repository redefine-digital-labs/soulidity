import { execFileSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

describe('prisma client boundary', () => {
  it('does not let app code import generated prisma clients directly', () => {
    let output = ''
    try {
      output = execFileSync(
        'rg',
        [
          '-n',
          String.raw`from\s+['"][^'"]*(?:web/generated/prisma|generated/prisma)/`,
          'src',
          'scripts',
          'web',
          'tests',
          '-g',
          '*.{ts,tsx}',
          '-g',
          '!generated/**',
          '-g',
          '!web/generated/**',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          stdio: 'pipe',
        },
      )
    } catch (error) {
      const status = (error as NodeJS.ErrnoException & { status?: number }).status
      if (status !== 1) {
        throw error
      }
    }

    const offenders = output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith('src/db/prisma-client.ts:'))

    expect(offenders).toEqual([])
  })
})
