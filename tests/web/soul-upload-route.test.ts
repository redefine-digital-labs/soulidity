import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedUploadEncrypted = vi.hoisted(() => vi.fn())
const mockedUploadPublic = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@web/lib/rate-limit')>('@web/lib/rate-limit')
  return {
    ...actual,
    takeRateLimitToken: mockedTakeRateLimitToken,
  }
})

vi.mock('@web/lib/services/walrus', () => ({
  uploadEncrypted: mockedUploadEncrypted,
  uploadPublic: mockedUploadPublic,
}))

describe('soul upload route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1', kind: 'human' },
    })
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mockedUploadEncrypted.mockResolvedValue('blob-encrypted')
    mockedUploadPublic.mockResolvedValue('blob-public')
  })

  it('accepts encrypted uploads and returns blobId with contentHash', async () => {
    const { POST } = await import('../../web/app/api/souls/upload/route.ts')
    const form = new FormData()
    form.append('file', new File([Buffer.alloc(64, 7)], 'bundle.bin', { type: 'application/octet-stream' }))
    form.append('type', 'encrypted')

    const response = await POST(new Request('http://localhost/api/souls/upload', {
      method: 'POST',
      headers: { 'content-length': '256' },
      body: form,
    }) as any)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.blobId).toBe('blob-public')
    expect(body.contentHash).toBeDefined()
  })

  it('rejects non-file FormData values instead of crashing on arrayBuffer()', async () => {
    const { POST } = await import('../../web/app/api/souls/upload/route.ts')
    const form = new FormData()
    form.append('file', 'not-a-file')
    form.append('type', 'public')

    const response = await POST(new Request('http://localhost/api/souls/upload', {
      method: 'POST',
      headers: { 'content-length': '128' },
      body: form,
    }) as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'No file provided',
    })
    expect(mockedUploadPublic).not.toHaveBeenCalled()
  })

  it('returns 400 when multipart parsing fails before file validation', async () => {
    const { POST } = await import('../../web/app/api/souls/upload/route.ts')
    const response = await POST({
      headers: new Headers({ 'content-length': '128' }),
      formData: vi.fn().mockRejectedValue(new Error('bad multipart body')),
    } as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid multipart form data',
    })
    expect(mockedUploadPublic).not.toHaveBeenCalled()
  })
})
