import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  desktopDeviceSession: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  desktopPet: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  walletBinding: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  member: {
    create: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}))

function resetMocks() {
  vi.resetAllMocks()
  mockedPrisma.$transaction.mockImplementation(
    (fn: (tx: typeof mockedPrisma) => Promise<unknown>) => fn(mockedPrisma),
  )
}

vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))

describe('startDesktopDeviceSession', () => {
  beforeEach(resetMocks)

  it('creates a session with device and user codes', async () => {
    mockedPrisma.desktopDeviceSession.create.mockImplementation(({ data }) => {
      return Promise.resolve({
        deviceCode: data.deviceCode,
        userCode: data.userCode,
        expiresAt: data.expiresAt,
        pollIntervalSeconds: data.pollIntervalSeconds,
      })
    })

    const { startDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const now = new Date('2026-04-12T10:00:00Z')
    const result = await startDesktopDeviceSession({ now })

    expect(result.deviceCode).toBeTruthy()
    expect(result.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(result.pollInterval).toBe(5)
  })

  it('persists agentAddress when desktop starts linking', async () => {
    mockedPrisma.desktopDeviceSession.create.mockImplementation(({ data }) => {
      return Promise.resolve({
        deviceCode: data.deviceCode,
        userCode: data.userCode,
        expiresAt: data.expiresAt,
        pollIntervalSeconds: data.pollIntervalSeconds,
      })
    })

    const { startDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    await startDesktopDeviceSession({
      now: new Date('2026-04-12T10:00:00Z'),
      agentAddress: '0xagent123',
    })

    expect(mockedPrisma.desktopDeviceSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        agentAddress: '0xagent123',
      }),
    }))
  })
})

describe('pollDesktopDeviceSession', () => {
  beforeEach(resetMocks)

  it('returns invalid_code when session not found', async () => {
    mockedPrisma.desktopDeviceSession.findUnique.mockResolvedValue(null)

    const { pollDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await pollDesktopDeviceSession('nonexistent-code')

    expect(result.status).toBe('invalid_code')
  })

  it('returns pending for active unexpired session', async () => {
    const session = {
      id: 'session-1',
      accountId: null,
      agentAddress: null,
      deviceCode: 'device-abc',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      pollIntervalSeconds: 5,
      status: 'pending',
    }
    mockedPrisma.desktopDeviceSession.findUnique.mockResolvedValue(session)
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      status: 'pending',
      accountId: null,
      agentAddress: null,
      expiresAt: session.expiresAt,
      pollIntervalSeconds: 5,
    })

    const { pollDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await pollDesktopDeviceSession('device-abc', {
      now: new Date('2026-04-12T10:05:00Z'),
    })

    expect(result.status).toBe('pending')
  })

  it('expires session when past expiresAt', async () => {
    const session = {
      id: 'session-1',
      accountId: null,
      agentAddress: null,
      deviceCode: 'device-abc',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      pollIntervalSeconds: 5,
      status: 'pending',
    }
    mockedPrisma.desktopDeviceSession.findUnique.mockResolvedValue(session)
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      status: 'expired',
      accountId: null,
      agentAddress: null,
      expiresAt: session.expiresAt,
      pollIntervalSeconds: 5,
    })

    const { pollDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await pollDesktopDeviceSession('device-abc', {
      now: new Date('2026-04-12T10:15:00Z'),
    })

    expect(result.status).toBe('expired')
  })

  it('returns desktopAccessToken + agentApiKey when on-chain hash matches deterministic seed', async () => {
    const now = new Date('2026-04-12T10:15:00Z')
    const session = {
      id: 'session-1',
      accountId: 'account-123',
      agentAddress: '0xagent123',
      deviceCode: 'device-abc',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      pollIntervalSeconds: 5,
      status: 'confirmed',
    }
    mockedPrisma.desktopDeviceSession.findUnique.mockResolvedValue(session)
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      status: 'confirmed',
      accountId: 'account-123',
      agentAddress: '0xagent123',
      expiresAt: session.expiresAt,
      pollIntervalSeconds: 5,
    })

    const { generateAgentApiKeyForDeviceSession } = await import('../../web/lib/desktop/auth')
    const matchingHash = generateAgentApiKeyForDeviceSession('device-abc').hash
    mockedPrisma.desktopPet.findUnique.mockResolvedValue({
      agentMember: { apiKeyHash: matchingHash },
    })

    const { pollDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await pollDesktopDeviceSession('device-abc', { now })

    expect(result.status).toBe('confirmed')
    if (result.status === 'confirmed') {
      expect(result.desktopAccessToken).toMatch(/^dtk_[0-9a-f]{64}$/)
      expect(result.agentApiKey).toMatch(/^sk-[0-9a-f]{64}$/)
    }
  })

  it('omits agentApiKey when on-chain hash diverges (post-rotate)', async () => {
    const now = new Date('2026-04-12T10:15:00Z')
    const session = {
      id: 'session-1',
      accountId: 'account-123',
      agentAddress: '0xagent123',
      deviceCode: 'device-abc',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      pollIntervalSeconds: 5,
      status: 'confirmed',
    }
    mockedPrisma.desktopDeviceSession.findUnique.mockResolvedValue(session)
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      status: 'confirmed',
      accountId: 'account-123',
      agentAddress: '0xagent123',
      expiresAt: session.expiresAt,
      pollIntervalSeconds: 5,
    })
    mockedPrisma.desktopPet.findUnique.mockResolvedValue({
      agentMember: { apiKeyHash: 'rotated-hash-different-from-deterministic' },
    })

    const { pollDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await pollDesktopDeviceSession('device-abc', { now })

    expect(result.status).toBe('confirmed')
    if (result.status === 'confirmed') {
      expect(result.desktopAccessToken).toMatch(/^dtk_[0-9a-f]{64}$/)
      expect(result.agentApiKey).toBeUndefined()
    }
  })
})

describe('completeDesktopDeviceSession', () => {
  beforeEach(resetMocks)

  it('confirms a pending session and writes pet/member/binding', async () => {
    const now = new Date('2026-04-12T10:05:00Z')
    const session = {
      id: 'session-1',
      accountId: null,
      agentAddress: '0xagent123',
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      confirmedAt: null,
      pollIntervalSeconds: 5,
      status: 'pending',
    }
    mockedPrisma.desktopDeviceSession.findUnique
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ status: 'pending', accountId: null })
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      accountId: 'account-123',
      agentAddress: '0xagent123',
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: session.expiresAt,
      confirmedAt: now,
      pollIntervalSeconds: 5,
      status: 'confirmed',
    })
    mockedPrisma.walletBinding.findUnique.mockResolvedValue(null)
    mockedPrisma.member.create.mockResolvedValue({ id: 'member-new' })
    mockedPrisma.walletBinding.create.mockResolvedValue({})
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(null)
    mockedPrisma.desktopPet.create.mockResolvedValue({ id: 'pet-1' })
    mockedPrisma.desktopDeviceSession.updateMany.mockResolvedValue({ count: 0 })

    const { completeDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await completeDesktopDeviceSession('ABCD-EFGH', 'account-123', { now })

    expect(result.status).toBe('confirmed')
    expect(mockedPrisma.member.create).toHaveBeenCalled()
    expect(mockedPrisma.walletBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        chain: 'sui',
        address: '0xagent123',
        memberId: 'member-new',
      }),
    })
    expect(mockedPrisma.desktopPet.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'account-123',
        agentAddress: '0xagent123',
        agentMemberId: 'member-new',
        label: 'Desktop pet',
      }),
      select: { id: true },
    })
    expect(mockedPrisma.desktopDeviceSession.updateMany).toHaveBeenCalledWith({
      where: {
        accountId: 'account-123',
        agentAddress: '0xagent123',
        status: 'confirmed',
        id: { not: 'session-1' },
      },
      data: { status: 'expired' },
    })
    expect(result).not.toHaveProperty('desktopAccessToken')
    expect(result).not.toHaveProperty('agentApiKey')
    if (result.status === 'confirmed') {
      // Browser-safe pet hand-off for the post-link auto-authorize UX:
      // freshly persisted pet id + the linked agent address.
      expect(result.petId).toBe('pet-1')
      expect(result.agentAddress).toBe('0xagent123')
    }
  })

  it('throws DesktopPetAddressConflictError when address belongs to another account', async () => {
    const session = {
      id: 'session-1',
      accountId: null,
      agentAddress: '0xagent123',
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      confirmedAt: null,
      pollIntervalSeconds: 5,
      status: 'pending',
    }
    mockedPrisma.desktopDeviceSession.findUnique
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ status: 'pending', accountId: null })
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      accountId: 'account-123',
      agentAddress: '0xagent123',
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: session.expiresAt,
      confirmedAt: new Date('2026-04-12T10:05:00Z'),
      pollIntervalSeconds: 5,
      status: 'confirmed',
    })
    mockedPrisma.walletBinding.findUnique.mockResolvedValue({
      id: 'binding-1',
      memberId: 'member-other',
      member: { id: 'member-other', accountId: 'account-other', kind: 'agent' },
    })

    const { completeDesktopDeviceSession, DesktopPetAddressConflictError } =
      await import('../../web/lib/desktop/device-session')

    await expect(
      completeDesktopDeviceSession('ABCD-EFGH', 'account-123', {
        now: new Date('2026-04-12T10:05:00Z'),
      }),
    ).rejects.toBeInstanceOf(DesktopPetAddressConflictError)
  })

  it('throws DesktopDeviceSessionConflictError when concurrent confirmed by different account', async () => {
    const session = {
      id: 'session-1',
      accountId: null,
      agentAddress: '0xagent123',
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      confirmedAt: null,
      pollIntervalSeconds: 5,
      status: 'pending',
    }
    mockedPrisma.desktopDeviceSession.findUnique
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ status: 'confirmed', accountId: 'account-other' })

    const { completeDesktopDeviceSession, DesktopDeviceSessionConflictError } =
      await import('../../web/lib/desktop/device-session')

    await expect(
      completeDesktopDeviceSession('ABCD-EFGH', 'account-123', {
        now: new Date('2026-04-12T10:05:00Z'),
      }),
    ).rejects.toBeInstanceOf(DesktopDeviceSessionConflictError)
  })

  it('same-account replay of an already-confirmed session is idempotent and does not roll back a rotated agent API key', async () => {
    // Repro for the R-001 path: link a pet, rotate the agent API key, then
    // re-submit the same userCode while signed into the same account. Pre-fix
    // the confirmed-session branch unconditionally re-ran
    // `persistConfirmedDesktopPet`, which rewrote `Member.apiKeyHash` back to
    // the deterministic device-session seed and cleared `apiKeyRotationId`,
    // silently invalidating the rotated `sk-*` on disk.
    const now = new Date('2026-04-12T11:00:00Z')
    const confirmedAt = new Date('2026-04-12T10:05:00Z')
    const session = {
      id: 'session-1',
      accountId: 'account-123',
      agentAddress: '0xagent123',
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      confirmedAt,
      pollIntervalSeconds: 5,
      status: 'confirmed',
    }
    mockedPrisma.desktopDeviceSession.findUnique.mockResolvedValueOnce(session)
    // Replay still reads the existing pet so the confirmed response can
    // surface `petId` for the auto-authorize UX. This is a pure read — no
    // upsert, no apiKey rotation.
    mockedPrisma.desktopPet.findUnique.mockResolvedValueOnce({ id: 'existing-pet-1' })

    const { completeDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await completeDesktopDeviceSession('ABCD-EFGH', 'account-123', { now })

    expect(result.status).toBe('confirmed')
    if (result.status === 'confirmed') {
      expect(result.accountId).toBe('account-123')
      expect(result.confirmedAt).toBe(confirmedAt.toISOString())
      expect(result.petId).toBe('existing-pet-1')
      expect(result.agentAddress).toBe('0xagent123')
    }

    // No write-side prisma calls — confirmed-session replay is pure read.
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled()
    expect(mockedPrisma.member.update).not.toHaveBeenCalled()
    expect(mockedPrisma.desktopPet.update).not.toHaveBeenCalled()
    expect(mockedPrisma.desktopPet.create).not.toHaveBeenCalled()
    expect(mockedPrisma.desktopDeviceSession.update).not.toHaveBeenCalled()
    expect(mockedPrisma.desktopDeviceSession.updateMany).not.toHaveBeenCalled()
    expect(mockedPrisma.walletBinding.findUnique).not.toHaveBeenCalled()
    // The pet read is the only DB hit — by the unique key we stored at
    // confirm time. Verifies we don't rotate or overwrite anything.
    expect(mockedPrisma.desktopPet.findUnique).toHaveBeenCalledWith({
      where: {
        accountId_agentAddress: {
          accountId: 'account-123',
          agentAddress: '0xagent123',
        },
      },
      select: { id: true },
    })
  })

  it('returns expired when concurrent poll expires session during complete', async () => {
    const session = {
      id: 'session-1',
      accountId: null,
      agentAddress: null,
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      confirmedAt: null,
      pollIntervalSeconds: 5,
      status: 'pending',
    }
    mockedPrisma.desktopDeviceSession.findUnique
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ status: 'expired', accountId: null })

    const { completeDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await completeDesktopDeviceSession('ABCD-EFGH', 'account-123', {
      now: new Date('2026-04-12T10:05:00Z'),
    })

    expect(result.status).toBe('expired')
  })
})
