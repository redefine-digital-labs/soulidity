import { beforeEach, describe, expect, it, vi } from 'vitest'

const PRIMARY_WALLET = `0x${'1'.repeat(64)}`

const mockedRequireSoulCreateWalletIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedUploadPublic = vi.hoisted(() => vi.fn())
const mockedGetBlobUrl = vi.hoisted(() => vi.fn())
const mockedSealDekEnvelope = vi.hoisted(() => vi.fn())

vi.mock('@/lib/soulidity/server', () => ({
  requireSoulCreateWalletIdentity: mockedRequireSoulCreateWalletIdentity,
}))

vi.mock('@web/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@web/lib/rate-limit')>('@web/lib/rate-limit')
  return {
    ...actual,
    takeRateLimitToken: mockedTakeRateLimitToken,
  }
})

vi.mock('@web/lib/services/walrus', () => ({
  uploadPublic: mockedUploadPublic,
  getBlobUrl: mockedGetBlobUrl,
}))

vi.mock('@web/lib/services/dek-envelope', () => ({
  sealDekEnvelope: mockedSealDekEnvelope,
}))

describe('soul upload route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireSoulCreateWalletIdentity.mockResolvedValue({
      identity: { memberId: 'member-1', accountId: 'account-1', kind: 'human' },
      walletAddresses: [PRIMARY_WALLET],
      primarySuiAddress: PRIMARY_WALLET,
    })
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mockedUploadPublic.mockResolvedValue({
      blobId: 'blob-public',
      blobObjectId: '0xblob-object',
    })
    mockedGetBlobUrl.mockReturnValue('https://walrus.example/blob-public')
    mockedSealDekEnvelope.mockReturnValue('mock-envelope-token')
  })

  it('uploads encrypted blobs to Walrus with the bound wallet as the blob owner', async () => {
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
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      blobId: 'blob-public',
      blobObjectId: '0xblob-object',
      blobUrl: 'https://walrus.example/blob-public',
      sealDekEnvelope: 'mock-envelope-token',
    }))
    expect(mockedUploadPublic).toHaveBeenCalledWith(expect.any(Buffer), {
      sendObjectTo: PRIMARY_WALLET,
    })
  })

  it('rejects encrypted uploads when no bound Sui wallet is available', async () => {
    mockedRequireSoulCreateWalletIdentity.mockResolvedValueOnce({
      identity: { memberId: 'member-1', accountId: 'account-1', kind: 'human' },
      walletAddresses: [],
      primarySuiAddress: null,
    })

    const { POST } = await import('../../web/app/api/souls/upload/route.ts')
    const form = new FormData()
    form.append('file', new File([Buffer.alloc(64, 7)], 'bundle.bin', { type: 'application/octet-stream' }))
    form.append('type', 'encrypted')

    const response = await POST(new Request('http://localhost/api/souls/upload', {
      method: 'POST',
      headers: { 'content-length': '256' },
      body: form,
    }) as any)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Bind a Sui wallet before uploading encrypted Soul content',
    })
    expect(mockedUploadPublic).not.toHaveBeenCalled()
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
