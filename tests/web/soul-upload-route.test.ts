import { describe, expect, it } from 'vitest'

describe('retired Soul upload route', () => {
  it('rejects server-side uploads with a wallet-paid upload message', async () => {
    const { POST } = await import('../../web/app/api/souls/upload/route.ts')
    const response = await POST()

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      error: 'Server-side Soul upload is retired. Use wallet-paid browser Walrus upload with cost confirmation.',
    })
  })
})
