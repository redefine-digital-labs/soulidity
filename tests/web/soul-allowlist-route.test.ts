import { describe, expect, it } from 'vitest'

describe('soul allowlist route', () => {
  it('returns 410 for legacy allowlist writes', async () => {
    const { POST } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await POST()

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul allowlist has been retired. Use the Soulidity grant flow in new-web instead.',
    })
  })

  it('returns 410 for legacy allowlist clears', async () => {
    const { DELETE } = await import('../../web/app/api/souls/[id]/allowlist/route.ts')
    const response = await DELETE()

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      error: 'Soul allowlist has been retired. Use the Soulidity grant flow in new-web instead.',
    })
  })
})
