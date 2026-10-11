import { describe, expect, it } from 'vitest'

describe('retired Vercel Blob upload routes', () => {
  it('rejects client Blob upload token requests', async () => {
    const { POST } = await import('../../web/app/api/souls/upload/token/route.ts')
    const response = await POST()

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      error: 'Client Blob upload tokens are retired. Upload directly from the browser through wallet-paid Walrus.',
    })
  })

  it('rejects Vercel Blob finalize requests', async () => {
    const { POST } = await import('../../web/app/api/souls/upload/from-blob/route.ts')
    const response = await POST()

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      error: 'Vercel Blob staging is retired. Upload directly from the browser through wallet-paid Walrus.',
    })
  })
})
