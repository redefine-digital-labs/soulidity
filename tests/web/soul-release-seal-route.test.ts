import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

describe('soul release seal route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1', kind: 'human' },
    })
  })

  it('keeps the disabled seal release route behind auth', async () => {
    const { PATCH } = await import('../../web/app/api/souls/[id]/release/seal/route.ts')
    const response = await PATCH(
      new Request('http://localhost/api/souls/series-1/release/seal', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
      }) as any,
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('release publishing'),
    })
    expect(mockedRequireIdentity).toHaveBeenCalledTimes(1)
  })
})
