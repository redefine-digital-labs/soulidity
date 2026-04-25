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
  soulUploadBinding: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
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

function makeMockBinding(overrides: Partial<{
  kind: 'persona-sprite' | 'soul-content'
  uploadType: 'public' | 'encrypted'
  contentType: string
  pathname: string
  expiresAt: Date
  consumedAt: Date | null
}> = {}) {
  return {
    nonce: UPLOAD_NONCE,
    memberId: MEMBER_ID,
    blobUrl: BLOB_URL,
    pathname: overrides.pathname ?? 'souls/sprite/sheet.png',
    contentType: overrides.contentType ?? 'image/png',
    kind: overrides.kind ?? 'persona-sprite',
    uploadType: overrides.uploadType ?? 'public',
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
    consumedAt: overrides.consumedAt ?? null,
  }
}

describe('soul Vercel Blob upload routes', () => {
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
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockedPrisma.soulUploadBinding.findMany.mockResolvedValue([])
    mockedPrisma.soulUploadBinding.deleteMany.mockResolvedValue({ count: 0 })
    mockedPrisma.soulUploadBinding.create.mockResolvedValue({})
    mockedPrisma.soulUploadBinding.findUnique.mockResolvedValue(null)
    mockedPrisma.$transaction.mockImplementation(async (callback) => callback({
      soulUploadBinding: {
        findUnique: vi.fn().mockResolvedValue(makeMockBinding()),
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
      parseSoulUploadTokenPayload,
      recordSoulUploadBinding,
    } = await import('../../web/lib/soulidity/soul-upload-binding.ts')
    const parsed = parseSoulUploadTokenPayload(JSON.stringify({
      kind: 'persona-sprite',
      uploadType: 'public',
      memberId: MEMBER_ID,
      nonce: UPLOAD_NONCE,
    }))

    expect(parsed).toEqual({
      kind: 'persona-sprite',
      uploadType: 'public',
      memberId: MEMBER_ID,
      nonce: UPLOAD_NONCE,
    })
    await recordSoulUploadBinding({
      memberId: parsed!.memberId,
      nonce: parsed!.nonce,
      blobUrl: BLOB_URL,
      pathname: 'souls/sprite/sheet.png',
      contentType: 'image/png',
      kind: parsed!.kind,
      uploadType: parsed!.uploadType,
    }, {
      deleteBlob: mockedBlobDelete,
    })
    expect(mockedPrisma.soulUploadBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memberId: MEMBER_ID,
        nonce: UPLOAD_NONCE,
        blobUrl: BLOB_URL,
        pathname: 'souls/sprite/sheet.png',
        contentType: 'image/png',
        kind: 'persona-sprite',
        uploadType: 'public',
      }),
    })
  })

  it('deletes the orphan blob when a duplicate-nonce callback collides with an existing binding', async () => {
    const SECOND_BLOB_URL = 'https://store.public.blob.vercel-storage.com/souls/sprite/sheet-second.png'
    const { PrismaClientKnownRequestError } = await import('@db/prisma-client').then((m) => m.PrismaRuntime)
    const conflictError = new PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['nonce'] },
    })
    mockedPrisma.soulUploadBinding.create.mockRejectedValueOnce(conflictError)
    mockedPrisma.soulUploadBinding.findUnique.mockResolvedValueOnce({
      blobUrl: BLOB_URL,
    })

    const { recordSoulUploadBinding } = await import('../../web/lib/soulidity/soul-upload-binding.ts')
    await recordSoulUploadBinding({
      memberId: MEMBER_ID,
      nonce: UPLOAD_NONCE,
      blobUrl: SECOND_BLOB_URL,
      pathname: 'souls/sprite/sheet-second.png',
      contentType: 'image/png',
      kind: 'persona-sprite',
      uploadType: 'public',
    }, {
      deleteBlob: mockedBlobDelete,
    })

    expect(mockedPrisma.soulUploadBinding.findUnique).toHaveBeenCalledWith({
      where: { nonce: UPLOAD_NONCE },
      select: { blobUrl: true },
    })
    expect(mockedBlobDelete).toHaveBeenCalledWith(SECOND_BLOB_URL)
  })

  it('keeps the no-op when the same nonce + blobUrl callback fires twice', async () => {
    const { PrismaClientKnownRequestError } = await import('@db/prisma-client').then((m) => m.PrismaRuntime)
    const conflictError = new PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['nonce'] },
    })
    mockedPrisma.soulUploadBinding.create.mockRejectedValueOnce(conflictError)
    mockedPrisma.soulUploadBinding.findUnique.mockResolvedValueOnce({
      blobUrl: BLOB_URL,
    })

    const { recordSoulUploadBinding } = await import('../../web/lib/soulidity/soul-upload-binding.ts')
    await recordSoulUploadBinding({
      memberId: MEMBER_ID,
      nonce: UPLOAD_NONCE,
      blobUrl: BLOB_URL,
      pathname: 'souls/sprite/sheet.png',
      contentType: 'image/png',
      kind: 'persona-sprite',
      uploadType: 'public',
    }, {
      deleteBlob: mockedBlobDelete,
    })

    expect(mockedBlobDelete).not.toHaveBeenCalled()
  })

  it('deletes expired unconsumed staging blobs before pruning binding rows', async () => {
    const expiredBlobUrl = 'https://store.public.blob.vercel-storage.com/souls/sprite/expired.png'
    mockedPrisma.soulUploadBinding.findMany.mockResolvedValueOnce([
      { id: 'binding-1', blobUrl: expiredBlobUrl },
    ])

    const { recordSoulUploadBinding } = await import('../../web/lib/soulidity/soul-upload-binding.ts')
    await recordSoulUploadBinding({
      memberId: MEMBER_ID,
      nonce: UPLOAD_NONCE,
      blobUrl: BLOB_URL,
      pathname: 'souls/sprite/sheet.png',
      contentType: 'image/png',
      kind: 'persona-sprite',
      uploadType: 'public',
    }, {
      deleteBlob: mockedBlobDelete,
    })

    expect(mockedBlobDelete).toHaveBeenCalledWith(expiredBlobUrl)
    expect(mockedPrisma.soulUploadBinding.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['binding-1'] } },
    })
  })

  it('keeps the binding row when the expired blob deletion fails', async () => {
    const expiredBlobUrl = 'https://store.public.blob.vercel-storage.com/souls/sprite/expired-fail.png'
    mockedPrisma.soulUploadBinding.findMany.mockResolvedValueOnce([
      { id: 'binding-stuck', blobUrl: expiredBlobUrl },
    ])

    const failingDelete = vi.fn().mockRejectedValueOnce(new Error('blob store transient outage'))

    const { recordSoulUploadBinding } = await import('../../web/lib/soulidity/soul-upload-binding.ts')
    await recordSoulUploadBinding({
      memberId: MEMBER_ID,
      nonce: UPLOAD_NONCE,
      blobUrl: BLOB_URL,
      pathname: 'souls/sprite/sheet.png',
      contentType: 'image/png',
      kind: 'persona-sprite',
      uploadType: 'public',
    }, {
      deleteBlob: failingDelete,
    })

    expect(failingDelete).toHaveBeenCalledWith(expiredBlobUrl)
    // The unconsumed-prune deleteMany must NOT include the failed-delete binding,
    // so a later pass can retry and we never lose retry state for the orphan blob.
    const unconsumedDeleteCall = mockedPrisma.soulUploadBinding.deleteMany.mock.calls.find((args: any[]) => {
      const where = args[0]?.where
      return where && where.id && Array.isArray(where.id.in)
    })
    expect(unconsumedDeleteCall).toBeUndefined()
  })

  it('retries blob cleanup for expired consumed rows that previously failed', async () => {
    const stuckBlobUrl = 'https://store.public.blob.vercel-storage.com/souls/sprite/consumed-stuck.png'
    mockedPrisma.soulUploadBinding.findMany.mockResolvedValueOnce([
      { id: 'consumed-stuck', blobUrl: stuckBlobUrl },
    ])

    const flakyDelete = vi.fn().mockRejectedValueOnce(new Error('transient blob outage'))
    const { pruneExpiredSoulUploadBindings } = await import('../../web/lib/soulidity/soul-upload-binding.ts')
    await pruneExpiredSoulUploadBindings(flakyDelete)

    expect(flakyDelete).toHaveBeenCalledWith(stuckBlobUrl)
    const reapCallAfterFailure = mockedPrisma.soulUploadBinding.deleteMany.mock.calls.find((args: any[]) => {
      const where = args[0]?.where
      return Array.isArray(where?.id?.in) && where.id.in.includes('consumed-stuck')
    })
    expect(reapCallAfterFailure).toBeUndefined()

    // Simulate a later prune pass: the row is still present because the
    // previous deletion failed, and the blob store has recovered. The retry
    // succeeds and the row is finally reaped.
    mockedPrisma.soulUploadBinding.findMany.mockResolvedValueOnce([
      { id: 'consumed-stuck', blobUrl: stuckBlobUrl },
    ])
    const recoveredDelete = vi.fn().mockResolvedValueOnce(undefined)
    await pruneExpiredSoulUploadBindings(recoveredDelete)

    expect(recoveredDelete).toHaveBeenCalledWith(stuckBlobUrl)
    expect(mockedPrisma.soulUploadBinding.deleteMany).toHaveBeenLastCalledWith({
      where: { id: { in: ['consumed-stuck'] } },
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
      kind: 'persona-sprite',
      uploadType: 'public',
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

  it('returns structured JSON when Walrus finalize throws', async () => {
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': String(pngBytes.byteLength) }),
      arrayBuffer: async () => pngBytes.buffer,
    }))
    mockedRunSoulUploadPipeline.mockRejectedValueOnce(new Error('Walrus publisher is not configured'))

    const { POST } = await import('../../web/app/api/souls/upload/from-blob/route.ts')
    const response = await POST(makeJsonRequest('/api/souls/upload/from-blob', {
      vercelBlobUrl: BLOB_URL,
      uploadNonce: UPLOAD_NONCE,
      kind: 'persona-sprite',
      uploadType: 'public',
      sendObjectTo: PRIMARY_WALLET,
      fileName: 'sheet.png',
    }) as any)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: 'Walrus publisher is not configured',
    })
  })

  it('does not fetch or delete foreign blobs without a matching binding', async () => {
    mockedPrisma.$transaction.mockImplementationOnce(async (callback) => callback({
      soulUploadBinding: {
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
      kind: 'persona-sprite',
      uploadType: 'public',
      sendObjectTo: PRIMARY_WALLET,
    }) as any)

    expect(response.status, JSON.stringify(await response.clone().json())).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Upload binding is not ready' })
    expect(mockedTakeRateLimitToken).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockedBlobDelete).not.toHaveBeenCalled()
    expect(mockedRunSoulUploadPipeline).not.toHaveBeenCalled()
  })

  it('rejects mismatched kind/uploadType so a public binding cannot be reused for an encrypted finalize', async () => {
    // The binding stored in transaction mock is { kind: 'persona-sprite', uploadType: 'public' }.
    // A finalize request that asks for 'encrypted' must be rejected with 400 + cleanupBlobUrl.
    // (The actual Vercel Blob `del` call inside `safeDelete` is best-effort and
    // its failure is swallowed; deletion behavior is covered by the prune tests
    // above which inject `deleteBlob` directly.)
    const { POST } = await import('../../web/app/api/souls/upload/from-blob/route.ts')
    const response = await POST(makeJsonRequest('/api/souls/upload/from-blob', {
      vercelBlobUrl: BLOB_URL,
      uploadNonce: UPLOAD_NONCE,
      kind: 'persona-sprite',
      uploadType: 'encrypted',
      sendObjectTo: PRIMARY_WALLET,
    }) as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Upload binding kind/type does not match this finalize request',
    })
    expect(mockedTakeRateLimitToken).not.toHaveBeenCalled()
    expect(mockedRunSoulUploadPipeline).not.toHaveBeenCalled()
  })
})
