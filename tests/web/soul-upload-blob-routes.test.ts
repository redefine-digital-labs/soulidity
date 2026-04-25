import { beforeEach, describe, expect, it, vi } from 'vitest'

const MEMBER_ID = '11111111-1111-4111-8111-111111111111'
const PRIMARY_WALLET = `0x${'1'.repeat(64)}`
const UPLOAD_NONCE = '22222222-2222-4222-8222-222222222222'
const BLOB_URL = 'https://store.public.blob.vercel-storage.com/souls/sprite/sheet.png'

const mockedRequireSoulCreateWalletIdentity = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedRunSoulUploadPipeline = vi.hoisted(() => vi.fn())
const mockedBlobDelete = vi.hoisted(() => vi.fn())
const mockedHandleUpload = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  $transaction: vi.fn(),
  soulSpriteUploadBinding: {
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
}))

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
vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@web/lib/rate-limit')>('@web/lib/rate-limit')
  return {
    ...actual,
    takeRateLimitToken: mockedTakeRateLimitToken,
  }
})

vi.mock('@web/lib/soulidity/soul-upload-pipeline', () => ({
  runSoulUploadPipeline: mockedRunSoulUploadPipeline,
}))
vi.mock('@/lib/soulidity/soul-upload-pipeline', () => ({
  runSoulUploadPipeline: mockedRunSoulUploadPipeline,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@vercel/blob', () => ({
  del: mockedBlobDelete,
}))

vi.mock('@vercel/blob/client', () => ({
  handleUpload: mockedHandleUpload,
}))

function makeJsonRequest(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('sprite Vercel Blob upload routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    vi.unstubAllGlobals()

    mockedRequireSoulCreateWalletIdentity.mockResolvedValue({
      identity: { memberId: MEMBER_ID, accountId: 'account-1', kind: 'human' },
      walletAddresses: [PRIMARY_WALLET],
      primarySuiAddress: PRIMARY_WALLET,
    })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedBlobDelete.mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedPrisma.soulSpriteUploadBinding.deleteMany.mockResolvedValue({ count: 0 })
    mockedPrisma.soulSpriteUploadBinding.create.mockResolvedValue({})
    mockedPrisma.$transaction.mockImplementation(async (callback) => callback({
      soulSpriteUploadBinding: {
        findUnique: vi.fn().mockResolvedValue({
          nonce: UPLOAD_NONCE,
          memberId: MEMBER_ID,
          blobUrl: BLOB_URL,
          pathname: 'souls/sprite/sheet.png',
          contentType: 'image/png',
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    }))
    mockedRunSoulUploadPipeline.mockResolvedValue({
      ok: true,
      payload: {
        blobId: 'walrus-blob',
        blobObjectId: '0xwalrus',
        contentHash: 'hash',
        blobUrl: 'https://walrus.example/walrus-blob',
        skillName: null,
      },
    })
  })

  it('records a one-shot binding from a signed upload-completed token payload', async () => {
    const {
      parseSpriteUploadTokenPayload,
      recordSpriteUploadBinding,
    } = await import('../../web/lib/soulidity/sprite-upload-binding.ts')
    const parsed = parseSpriteUploadTokenPayload(JSON.stringify({
      kind: 'persona-sprite',
      memberId: MEMBER_ID,
      nonce: UPLOAD_NONCE,
    }))

    expect(parsed).toEqual({
      kind: 'persona-sprite',
      memberId: MEMBER_ID,
      nonce: UPLOAD_NONCE,
    })
    await recordSpriteUploadBinding({
      memberId: parsed!.memberId,
      nonce: parsed!.nonce,
      blobUrl: BLOB_URL,
      pathname: 'souls/sprite/sheet.png',
      contentType: 'image/png',
    })
    expect(mockedPrisma.soulSpriteUploadBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memberId: MEMBER_ID,
        nonce: UPLOAD_NONCE,
        blobUrl: BLOB_URL,
        pathname: 'souls/sprite/sheet.png',
        contentType: 'image/png',
      }),
    })
  })

  it('consumes the binding and rate-limits the actual Walrus write in from-blob', async () => {
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': String(pngBytes.byteLength) }),
      arrayBuffer: async () => pngBytes.buffer,
    }))

    const { POST } = await import('../../web/app/api/souls/upload/from-blob/route.ts')
    const response = await POST(makeJsonRequest('/api/souls/upload/from-blob', {
      vercelBlobUrl: BLOB_URL,
      uploadNonce: UPLOAD_NONCE,
      type: 'public',
      sendObjectTo: PRIMARY_WALLET,
      fileName: 'sheet.png',
      fileType: 'application/zip',
    }) as any)

    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200)
    expect(mockedTakeRateLimitToken).toHaveBeenCalledWith('soul-upload:11111111-1111-4111-8111-111111111111', {
      max: 10,
      windowMs: 300_000,
    })
    expect(mockedRunSoulUploadPipeline).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'sheet.png',
      fileType: 'image/png',
      type: 'public',
      sendObjectTo: PRIMARY_WALLET,
      memberWalletAddress: PRIMARY_WALLET,
    }))
  })

  it('does not fetch or delete foreign blobs without a matching binding', async () => {
    mockedPrisma.$transaction.mockImplementationOnce(async (callback) => callback({
      soulSpriteUploadBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
      },
    }))
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { POST } = await import('../../web/app/api/souls/upload/from-blob/route.ts')
    const response = await POST(makeJsonRequest('/api/souls/upload/from-blob', {
      vercelBlobUrl: BLOB_URL,
      uploadNonce: UPLOAD_NONCE,
      type: 'public',
      sendObjectTo: PRIMARY_WALLET,
    }) as any)

    expect(response.status, JSON.stringify(await response.clone().json())).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Upload binding is not ready' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockedBlobDelete).not.toHaveBeenCalled()
    expect(mockedRunSoulUploadPipeline).not.toHaveBeenCalled()
  })

  it('rejects encrypted finalize attempts so private uploads cannot use public Blob staging', async () => {
    const { POST } = await import('../../web/app/api/souls/upload/from-blob/route.ts')
    const response = await POST(makeJsonRequest('/api/souls/upload/from-blob', {
      vercelBlobUrl: BLOB_URL,
      uploadNonce: UPLOAD_NONCE,
      type: 'encrypted',
      sendObjectTo: PRIMARY_WALLET,
    }) as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Blob staging is only allowed for public sprite uploads',
    })
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockedRunSoulUploadPipeline).not.toHaveBeenCalled()
  })
})
