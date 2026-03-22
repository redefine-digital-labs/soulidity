import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('soul public config', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.NEXT_PUBLIC_SOUL_PACKAGE_ID
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('throws a clear error when a required public env var is missing', async () => {
    const { getRequiredPublicEnv } = await import('../../web/lib/souls/config.ts')

    expect(() => getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')).toThrow(
      'NEXT_PUBLIC_SOUL_PACKAGE_ID is not configured',
    )
  })

  it('trims configured public env values', async () => {
    process.env.NEXT_PUBLIC_SOUL_PACKAGE_ID = ' 0xpackage '

    const { getRequiredPublicEnv } = await import('../../web/lib/souls/config.ts')

    expect(getRequiredPublicEnv('NEXT_PUBLIC_SOUL_PACKAGE_ID')).toBe('0xpackage')
  })
})
