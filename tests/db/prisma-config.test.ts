import { describe, expect, it } from 'vitest'

import { resolvePrismaDatabaseUrl } from '../../prisma.config'

describe('Prisma config environment resolution', () => {
  it('falls back to DATABASE_URL when DIRECT_URL is blank', () => {
    expect(
      resolvePrismaDatabaseUrl({
        DIRECT_URL: '   ',
        DATABASE_URL: 'postgresql://user:pass@example.com:5432/app',
      }),
    ).toBe('postgresql://user:pass@example.com:5432/app')
  })

  it('prefers a non-empty DIRECT_URL over DATABASE_URL', () => {
    expect(
      resolvePrismaDatabaseUrl({
        DIRECT_URL: 'postgresql://user:pass@example.com:5432/direct',
        DATABASE_URL: 'postgresql://user:pass@example.com:5432/app',
      }),
    ).toBe('postgresql://user:pass@example.com:5432/direct')
  })
})
