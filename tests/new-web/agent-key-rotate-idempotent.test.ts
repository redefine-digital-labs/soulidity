import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedRequireDesktopIdentity = vi.hoisted(() => vi.fn())

const mockedPrisma = vi.hoisted(() => ({
  member: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}))

function resetMocks() {
  vi.resetAllMocks()
  mockedPrisma.$transaction.mockImplementation(
    (fn: (tx: typeof mockedPrisma) => Promise<unknown>) => fn(mockedPrisma),
  )
}

vi.mock('@/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))

vi.mock('@/lib/desktop/auth', async () => {
  const actual = await vi.importActual<typeof import('../../web/lib/desktop/auth')>('@/lib/desktop/auth')
  return {
    ...actual,
    requireDesktopIdentity: mockedRequireDesktopIdentity,
  }
})

const PET_IDENTITY = {
  id: 'pet-abc',
  accountId: 'account-123',
  agentAddress: '0xagent123',
  agentMemberId: 'member-agent-1',
}

const ROTATION_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ROTATION_ID = '22222222-2222-4222-8222-222222222222'

function buildRequest(body: unknown): Request {
  return new Request('http://localhost', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/desktop/me/agent-key/rotate', () => {
  beforeEach(() => {
    resetMocks()
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: 'account-123',
      desktopPet: PET_IDENTITY,
    })
  })

  it('returns the same apiKey without writing when rotationId is already committed', async () => {
    const { generateAgentApiKeyForRotation } = await import('../../web/lib/desktop/auth')
    const expected = generateAgentApiKeyForRotation(PET_IDENTITY.agentMemberId, ROTATION_ID)

    mockedPrisma.member.findUnique.mockResolvedValue({
      id: PET_IDENTITY.agentMemberId,
      apiKeyHash: expected.hash,
      apiKeyRotationId: ROTATION_ID,
      pendingApiKeyHash: null,
      pendingApiKeyRotationId: null,
      pendingApiKeyRotationExpiresAt: null,
    })

    const { POST } = await import('../../web/app/api/desktop/me/agent-key/rotate/route')
    const response = await POST(buildRequest({ rotationId: ROTATION_ID }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.apiKey).toBe(expected.apiKey)
    expect(mockedPrisma.member.update).not.toHaveBeenCalled()
  })

  it('returns the same apiKey without writing when rotationId is still pending and not expired', async () => {
    const { generateAgentApiKeyForRotation } = await import('../../web/lib/desktop/auth')
    const expected = generateAgentApiKeyForRotation(PET_IDENTITY.agentMemberId, ROTATION_ID)

    mockedPrisma.member.findUnique.mockResolvedValue({
      id: PET_IDENTITY.agentMemberId,
      apiKeyHash: 'old-hash',
      apiKeyRotationId: 'old-rotation-id',
      pendingApiKeyHash: expected.hash,
      pendingApiKeyRotationId: ROTATION_ID,
      pendingApiKeyRotationExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })

    const { POST } = await import('../../web/app/api/desktop/me/agent-key/rotate/route')
    const response = await POST(buildRequest({ rotationId: ROTATION_ID }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.apiKey).toBe(expected.apiKey)
    expect(mockedPrisma.member.update).not.toHaveBeenCalled()
  })

  it('clears stale pending row and proceeds with the new rotation', async () => {
    const { generateAgentApiKeyForRotation } = await import('../../web/lib/desktop/auth')
    const expected = generateAgentApiKeyForRotation(PET_IDENTITY.agentMemberId, ROTATION_ID)

    mockedPrisma.member.findUnique.mockResolvedValue({
      id: PET_IDENTITY.agentMemberId,
      apiKeyHash: 'old-hash',
      apiKeyRotationId: 'old-rotation-id',
      pendingApiKeyHash: 'stale-pending-hash',
      pendingApiKeyRotationId: 'stale-rotation-id',
      pendingApiKeyRotationExpiresAt: new Date(Date.now() - 60 * 1000),
    })

    const { POST } = await import('../../web/app/api/desktop/me/agent-key/rotate/route')
    const response = await POST(buildRequest({ rotationId: ROTATION_ID }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.apiKey).toBe(expected.apiKey)

    // Two updates: clear stale pending, then write new pending. Both must
    // leave apiKeyHash untouched.
    expect(mockedPrisma.member.update).toHaveBeenCalledTimes(2)

    const firstCall = mockedPrisma.member.update.mock.calls[0][0]
    expect(firstCall.data.pendingApiKeyHash).toBeNull()
    expect(firstCall.data.pendingApiKeyRotationId).toBeNull()
    expect(firstCall.data.pendingApiKeyRotationExpiresAt).toBeNull()
    expect(firstCall.data).not.toHaveProperty('apiKeyHash')

    const secondCall = mockedPrisma.member.update.mock.calls[1][0]
    expect(secondCall.data.pendingApiKeyHash).toBe(expected.hash)
    expect(secondCall.data.pendingApiKeyRotationId).toBe(ROTATION_ID)
    expect(secondCall.data.pendingApiKeyRotationExpiresAt).toBeInstanceOf(Date)
    expect(secondCall.data).not.toHaveProperty('apiKeyHash')
  })

  it('writes pending fields and never touches apiKeyHash on first-time rotation', async () => {
    const { generateAgentApiKeyForRotation } = await import('../../web/lib/desktop/auth')
    const expected = generateAgentApiKeyForRotation(PET_IDENTITY.agentMemberId, ROTATION_ID)

    mockedPrisma.member.findUnique.mockResolvedValue({
      id: PET_IDENTITY.agentMemberId,
      apiKeyHash: 'committed-hash-old',
      apiKeyRotationId: 'rotation-old',
      pendingApiKeyHash: null,
      pendingApiKeyRotationId: null,
      pendingApiKeyRotationExpiresAt: null,
    })

    const { POST } = await import('../../web/app/api/desktop/me/agent-key/rotate/route')
    const response = await POST(buildRequest({ rotationId: ROTATION_ID }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.apiKey).toBe(expected.apiKey)

    expect(mockedPrisma.member.update).toHaveBeenCalledTimes(1)
    const updateCall = mockedPrisma.member.update.mock.calls[0][0]
    expect(updateCall.where).toEqual({ id: PET_IDENTITY.agentMemberId })
    expect(updateCall.data.pendingApiKeyHash).toBe(expected.hash)
    expect(updateCall.data.pendingApiKeyRotationId).toBe(ROTATION_ID)
    expect(updateCall.data.pendingApiKeyRotationExpiresAt).toBeInstanceOf(Date)
    // Must NOT touch apiKeyHash / apiKeyRotationId.
    expect(updateCall.data).not.toHaveProperty('apiKeyHash')
    expect(updateCall.data).not.toHaveProperty('apiKeyRotationId')
  })

  it('returns 409 rotation_in_progress when another rotationId is still pending', async () => {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: PET_IDENTITY.agentMemberId,
      apiKeyHash: 'old-hash',
      apiKeyRotationId: 'rotation-old',
      pendingApiKeyHash: 'pending-hash-other',
      pendingApiKeyRotationId: OTHER_ROTATION_ID,
      pendingApiKeyRotationExpiresAt: expiresAt,
    })

    const { POST } = await import('../../web/app/api/desktop/me/agent-key/rotate/route')
    const response = await POST(buildRequest({ rotationId: ROTATION_ID }))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toBe('rotation_in_progress')
    expect(body.rotationId).toBe(OTHER_ROTATION_ID)
    expect(body.expiresAt).toBe(expiresAt.toISOString())
    expect(mockedPrisma.member.update).not.toHaveBeenCalled()
  })

  it('returns 403 when desktop pet identity is missing (browser cookie path)', async () => {
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: 'account-123',
      identity: { accountId: 'account-123', kind: 'human' },
    })

    const { POST } = await import('../../web/app/api/desktop/me/agent-key/rotate/route')
    const response = await POST(buildRequest({ rotationId: ROTATION_ID }))

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error).toBe('Desktop pet identity required')
  })

  it('returns 400 for missing/empty/oversized rotationId', async () => {
    const { POST } = await import('../../web/app/api/desktop/me/agent-key/rotate/route')

    const cases: Array<{ rotationId?: unknown }> = [
      {},
      { rotationId: '' },
      { rotationId: 12345 },
      { rotationId: 'a'.repeat(65) },
    ]

    for (const body of cases) {
      const response = await POST(buildRequest(body))
      expect(response.status).toBe(400)
    }
  })
})

describe('POST /api/desktop/me/agent-key/rotate/commit', () => {
  beforeEach(() => {
    resetMocks()
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: 'account-123',
      desktopPet: PET_IDENTITY,
    })
  })

  it('promotes pending → active when pending matches and is not expired', async () => {
    const { generateAgentApiKeyForRotation } = await import('../../web/lib/desktop/auth')
    const expected = generateAgentApiKeyForRotation(PET_IDENTITY.agentMemberId, ROTATION_ID)

    mockedPrisma.member.findUnique.mockResolvedValue({
      id: PET_IDENTITY.agentMemberId,
      apiKeyHash: 'old-hash',
      apiKeyRotationId: 'rotation-old',
      pendingApiKeyHash: expected.hash,
      pendingApiKeyRotationId: ROTATION_ID,
      pendingApiKeyRotationExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })

    const { POST } = await import('../../web/app/api/desktop/me/agent-key/rotate/commit/route')
    const response = await POST(buildRequest({ rotationId: ROTATION_ID }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)

    expect(mockedPrisma.member.update).toHaveBeenCalledTimes(1)
    const call = mockedPrisma.member.update.mock.calls[0][0]
    expect(call.where).toEqual({ id: PET_IDENTITY.agentMemberId })
    expect(call.data).toEqual({
      apiKey: null,
      apiKeyHash: expected.hash,
      apiKeyRotationId: ROTATION_ID,
      pendingApiKeyHash: null,
      pendingApiKeyRotationId: null,
      pendingApiKeyRotationExpiresAt: null,
    })
  })

  it('returns 200 ok without writing when commit is replayed (apiKeyRotationId === rotationId)', async () => {
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: PET_IDENTITY.agentMemberId,
      apiKeyHash: 'committed-hash',
      apiKeyRotationId: ROTATION_ID,
      pendingApiKeyHash: null,
      pendingApiKeyRotationId: null,
      pendingApiKeyRotationExpiresAt: null,
    })

    const { POST } = await import('../../web/app/api/desktop/me/agent-key/rotate/commit/route')
    const response = await POST(buildRequest({ rotationId: ROTATION_ID }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockedPrisma.member.update).not.toHaveBeenCalled()
  })

  it('returns 409 stale-rotation when pending is expired and old apiKeyHash is unchanged', async () => {
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: PET_IDENTITY.agentMemberId,
      apiKeyHash: 'committed-hash-old',
      apiKeyRotationId: 'rotation-old',
      pendingApiKeyHash: 'stale-pending',
      pendingApiKeyRotationId: ROTATION_ID,
      pendingApiKeyRotationExpiresAt: new Date(Date.now() - 60 * 1000),
    })

    const { POST } = await import('../../web/app/api/desktop/me/agent-key/rotate/commit/route')
    const response = await POST(buildRequest({ rotationId: ROTATION_ID }))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toBe('stale-rotation')
    expect(mockedPrisma.member.update).not.toHaveBeenCalled()
  })

  it('returns 409 stale-rotation when no pending row exists', async () => {
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: PET_IDENTITY.agentMemberId,
      apiKeyHash: 'committed-hash-old',
      apiKeyRotationId: 'rotation-old',
      pendingApiKeyHash: null,
      pendingApiKeyRotationId: null,
      pendingApiKeyRotationExpiresAt: null,
    })

    const { POST } = await import('../../web/app/api/desktop/me/agent-key/rotate/commit/route')
    const response = await POST(buildRequest({ rotationId: ROTATION_ID }))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toBe('stale-rotation')
    expect(mockedPrisma.member.update).not.toHaveBeenCalled()
  })

  it('returns 403 when desktop pet identity is missing (browser cookie path)', async () => {
    mockedRequireDesktopIdentity.mockResolvedValue({
      accountId: 'account-123',
      identity: { accountId: 'account-123', kind: 'human' },
    })

    const { POST } = await import('../../web/app/api/desktop/me/agent-key/rotate/commit/route')
    const response = await POST(buildRequest({ rotationId: ROTATION_ID }))

    expect(response.status).toBe(403)
  })
})

describe('generateAgentApiKeyForRotation determinism', () => {
  it('returns the same apiKey for the same (memberId, rotationId)', async () => {
    const { generateAgentApiKeyForRotation } = await import('../../web/lib/desktop/auth')
    const a = generateAgentApiKeyForRotation('member-1', 'rot-1')
    const b = generateAgentApiKeyForRotation('member-1', 'rot-1')
    expect(a.apiKey).toBe(b.apiKey)
    expect(a.hash).toBe(b.hash)
    expect(a.apiKey.startsWith('sk-')).toBe(true)
  })

  it('produces distinct apiKeys for different rotationIds', async () => {
    const { generateAgentApiKeyForRotation } = await import('../../web/lib/desktop/auth')
    const a = generateAgentApiKeyForRotation('member-1', 'rot-1')
    const b = generateAgentApiKeyForRotation('member-1', 'rot-2')
    expect(a.apiKey).not.toBe(b.apiKey)
  })

  it('produces distinct apiKeys for different members', async () => {
    const { generateAgentApiKeyForRotation } = await import('../../web/lib/desktop/auth')
    const a = generateAgentApiKeyForRotation('member-1', 'rot-1')
    const b = generateAgentApiKeyForRotation('member-2', 'rot-1')
    expect(a.apiKey).not.toBe(b.apiKey)
  })
})
