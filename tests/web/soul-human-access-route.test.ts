import { beforeEach, describe, expect, it, vi } from 'vitest'

const PACKAGE_ID = `0x${'9'.repeat(64)}`
const SOUL_ID = `0x${'1'.repeat(64)}`
const ALLOWLIST_REGISTRY_ID = `0x${'8'.repeat(64)}`
const VALID_ENCRYPTED_DEK = Buffer.from('encrypted-dek').toString('base64')
const VALID_IV = Buffer.alloc(12, 7).toString('base64')

function buildValidDocumentId(soulObjectId: string) {
  const domainHex = Buffer.from('soul-seal:', 'utf8').toString('hex')
  return `0x${domainHex}01${soulObjectId.slice(2).padStart(64, '0')}${'0'.repeat(32)}`
}

function makeSealSidecar() {
  return {
    version: 1,
    mode: 'seal-envelope' as const,
    documentId: buildValidDocumentId(SOUL_ID),
    encryptedDek: VALID_ENCRYPTED_DEK,
    iv: VALID_IV,
    cipher: 'AES-GCM-256' as const,
    mimeType: 'application/octet-stream',
    fileName: 'soul.bin',
    contentHash: 'b'.repeat(64),
  }
}

const MockOnChainVerificationError = vi.hoisted(() => class MockOnChainVerificationError extends Error {
  status: number

  constructor(message: string, status = 422) {
    super(message)
    this.status = status
  }
})

const MockSoulAccessDeniedError = vi.hoisted(() => class MockSoulAccessDeniedError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
})

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedGetMemberSuiWalletAddresses = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedFindSoulAssetDetailByRouteId = vi.hoisted(() => vi.fn())
const mockedResolveSoulAccessPayload = vi.hoisted(() => vi.fn())
const mockedHasSealSessionConfig = vi.hoisted(() => vi.fn())
const mockedHasCredentialedSealServerConfigs = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberSuiWalletAddresses: mockedGetMemberSuiWalletAddresses,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/souls/repository', () => ({
  findSoulAssetDetailByRouteId: mockedFindSoulAssetDetailByRouteId,
}))

vi.mock('@web/lib/souls/on-chain-verification', () => ({
  OnChainVerificationError: MockOnChainVerificationError,
}))

vi.mock('@web/lib/souls/access', () => ({
  resolveSoulAccessPayload: mockedResolveSoulAccessPayload,
  SoulAccessDeniedError: MockSoulAccessDeniedError,
}))

vi.mock('@web/lib/services/seal', () => ({
  hasSealSessionConfig: mockedHasSealSessionConfig,
  hasCredentialedSealServerConfigs: mockedHasCredentialedSealServerConfigs,
}))

describe('Soul human access route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID = PACKAGE_ID
    process.env.NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID = ALLOWLIST_REGISTRY_ID

    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1', kind: 'human' },
    })
    mockedTakeRateLimitToken.mockResolvedValue({ limited: false, retryAfterSeconds: 60 })
    mockedHasSealSessionConfig.mockReturnValue(true)
    mockedHasCredentialedSealServerConfigs.mockReturnValue(false)
    mockedFindSoulAssetDetailByRouteId.mockResolvedValue({
      id: 'asset-db-1',
      onChainId: SOUL_ID,
      sealSidecar: makeSealSidecar(),
    })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([`0x${'2'.repeat(64)}`])
    mockedResolveSoulAccessPayload.mockResolvedValue({ ok: true })
  })

  it('returns 409 when the viewer has multiple Sui wallet bindings', async () => {
    const walletError = new Error('Multiple Sui wallets')
    walletError.name = 'MultipleSuiWalletBindingsError'
    mockedGetMemberSuiWalletAddresses.mockRejectedValueOnce(walletError)

    const { GET } = await import('../../web/app/api/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Multiple Sui wallets' })
    expect(mockedResolveSoulAccessPayload).not.toHaveBeenCalled()
  })

  it('rejects non-human identities before reading Soul state', async () => {
    mockedRequireIdentity.mockResolvedValueOnce({
      error: null,
      identity: { memberId: 'member-1', kind: 'agent' },
    })

    const { GET } = await import('../../web/app/api/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'This access route only supports human sessions',
    })
    expect(mockedFindSoulAssetDetailByRouteId).not.toHaveBeenCalled()
  })

  it('rate limits before loading Soul access state', async () => {
    mockedTakeRateLimitToken.mockResolvedValueOnce({ limited: true, retryAfterSeconds: 120 })

    const { GET } = await import('../../web/app/api/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'Too many access requests, try again later',
    })
    expect(mockedFindSoulAssetDetailByRouteId).not.toHaveBeenCalled()
  })

  it('returns 404 when the Soul does not exist', async () => {
    mockedFindSoulAssetDetailByRouteId.mockResolvedValueOnce(null)

    const { GET } = await import('../../web/app/api/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
    expect(mockedResolveSoulAccessPayload).not.toHaveBeenCalled()
  })

  it('returns 403 when the viewer has no bound Sui wallet', async () => {
    mockedGetMemberSuiWalletAddresses.mockResolvedValueOnce([])

    const { GET } = await import('../../web/app/api/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Bind a Sui wallet before accessing Soul content',
    })
    expect(mockedResolveSoulAccessPayload).not.toHaveBeenCalled()
  })

  it('returns 503 when Seal session config is unavailable', async () => {
    mockedHasSealSessionConfig.mockReturnValueOnce(false)

    const { GET } = await import('../../web/app/api/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Seal session is not configured',
    })
    expect(mockedFindSoulAssetDetailByRouteId).not.toHaveBeenCalled()
  })

  it('returns the resolved access payload on the happy path', async () => {
    mockedResolveSoulAccessPayload.mockResolvedValueOnce({
      accessKind: 'owner',
      viewerAddress: `0x${'2'.repeat(64)}`,
      seal: { network: 'testnet' },
    })

    const { GET } = await import('../../web/app/api/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      accessKind: 'owner',
      viewerAddress: `0x${'2'.repeat(64)}`,
      seal: { network: 'testnet' },
    })
    expect(mockedResolveSoulAccessPayload).toHaveBeenCalledWith({
      soul: expect.objectContaining({ onChainId: SOUL_ID }),
      viewerAddresses: [`0x${'2'.repeat(64)}`],
      soulPackageId: PACKAGE_ID,
      allowlistRegistryObjectId: ALLOWLIST_REGISTRY_ID,
    })
  })

  it('maps mocked SoulAccessDeniedError instances to the route status code', async () => {
    mockedResolveSoulAccessPayload.mockRejectedValueOnce(
      new MockSoulAccessDeniedError('Viewer does not have access to this Soul', 403),
    )

    const { GET } = await import('../../web/app/api/souls/[id]/access/route.ts')
    const response = await GET(
      new Request('http://localhost/api/souls/0xsoul/access') as any,
      { params: Promise.resolve({ id: SOUL_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Viewer does not have access to this Soul',
    })
  })
})
