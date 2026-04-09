import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('soul public config', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('throws a generic public error while keeping the missing env name on the error object', async () => {
    const { getRequiredPublicEnv, MissingPublicEnvError } = await import('../../web/lib/souls/config.ts')

    try {
      getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
      throw new Error('expected getRequiredPublicEnv to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(MissingPublicEnvError)
      expect((error as MissingPublicEnvError).message).toBe('Service temporarily unavailable')
      expect((error as MissingPublicEnvError).envName).toBe('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')
    }
  })

  it('trims configured public env values', async () => {
    process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID = ' 0xpackage '

    const { getRequiredPublicEnv } = await import('../../web/lib/souls/config.ts')

    expect(getRequiredPublicEnv('NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID')).toBe('0xpackage')
  })
})
