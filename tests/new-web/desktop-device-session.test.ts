import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  desktopDeviceSession: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  desktopProfile: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
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
      deviceCode: 'device-abc',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      pollIntervalSeconds: 5,
      status: 'pending',
    }
    mockedPrisma.desktopDeviceSession.findUnique.mockResolvedValue(session)
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      status: 'pending',
      accountId: null,
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
      deviceCode: 'device-abc',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      pollIntervalSeconds: 5,
      status: 'pending',
    }
    mockedPrisma.desktopDeviceSession.findUnique.mockResolvedValue(session)
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      status: 'expired',
      accountId: null,
      expiresAt: session.expiresAt,
      pollIntervalSeconds: 5,
    })

    const { pollDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await pollDesktopDeviceSession('device-abc', {
      now: new Date('2026-04-12T10:15:00Z'),
    })

    expect(result.status).toBe('expired')
  })

  it('preserves confirmed session even when past expiresAt', async () => {
    const session = {
      id: 'session-1',
      accountId: 'account-123',
      deviceCode: 'device-abc',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      pollIntervalSeconds: 5,
      status: 'confirmed',
    }
    mockedPrisma.desktopDeviceSession.findUnique.mockResolvedValue(session)
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      status: 'confirmed',
      accountId: 'account-123',
      expiresAt: session.expiresAt,
      pollIntervalSeconds: 5,
    })

    const { pollDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await pollDesktopDeviceSession('device-abc', {
      now: new Date('2026-04-12T10:15:00Z'),
    })

    expect(result.status).toBe('confirmed')
    expect(mockedPrisma.desktopDeviceSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { lastPolledAt: new Date('2026-04-12T10:15:00Z') },
      }),
    )
  })

  it('rotates a desktop token for confirmed sessions without reading plaintext preferences', async () => {
    const now = new Date('2026-04-12T10:15:00Z')
    const session = {
      id: 'session-1',
      accountId: 'account-123',
      deviceCode: 'device-abc',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      pollIntervalSeconds: 5,
      status: 'confirmed',
    }
    mockedPrisma.desktopDeviceSession.findUnique.mockResolvedValue(session)
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      status: 'confirmed',
      accountId: 'account-123',
      expiresAt: session.expiresAt,
      pollIntervalSeconds: 5,
    })
    mockedPrisma.desktopProfile.upsert.mockResolvedValue({
      accountId: 'account-123',
    })

    const { pollDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await pollDesktopDeviceSession('device-abc', { now })

    expect(result.status).toBe('confirmed')
    if (result.status === 'confirmed') {
      expect(result.desktopAccessToken).toMatch(/^dtk_[0-9a-f]{64}$/)
    }
    expect(mockedPrisma.desktopProfile.findUnique).not.toHaveBeenCalled()

    const upsertArgs = mockedPrisma.desktopProfile.upsert.mock.calls[0]?.[0]
    expect(upsertArgs).toBeTruthy()
    expect(upsertArgs.where).toEqual({ accountId: 'account-123' })
    expect(upsertArgs.create).toEqual(expect.objectContaining({
      accountId: 'account-123',
      desktopAccessTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      desktopAccessTokenIssuedAt: now,
    }))
    expect(upsertArgs.update).toEqual(expect.objectContaining({
      desktopAccessTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      desktopAccessTokenIssuedAt: now,
    }))
  })
})

describe('completeDesktopDeviceSession', () => {
  beforeEach(resetMocks)

  it('confirms session by user code', async () => {
    const session = {
      id: 'session-1',
      accountId: null,
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      confirmedAt: null,
      pollIntervalSeconds: 5,
      status: 'pending',
    }
    mockedPrisma.desktopDeviceSession.findUnique
      .mockResolvedValueOnce(session) // outer lookup
      .mockResolvedValueOnce({ status: 'pending', accountId: null }) // tx re-check
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      accountId: 'account-123',
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: session.expiresAt,
      confirmedAt: new Date('2026-04-12T10:05:00Z'),
      pollIntervalSeconds: 5,
      status: 'confirmed',
    })

    const { completeDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await completeDesktopDeviceSession('ABCD-EFGH', 'account-123', {
      now: new Date('2026-04-12T10:05:00Z'),
    })

    expect(result.status).toBe('confirmed')
    if (result.status === 'confirmed') {
      expect(result.accountId).toBe('account-123')
    }
    expect(mockedPrisma.$transaction).toHaveBeenCalledOnce()
  })

  it('upserts DesktopProfile.agentAddress when confirming a bound device session', async () => {
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
    mockedPrisma.desktopProfile.upsert.mockResolvedValue({
      accountId: 'account-123',
      agentAddress: '0xagent123',
    })

    const { completeDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await completeDesktopDeviceSession('ABCD-EFGH', 'account-123', {
      now: new Date('2026-04-12T10:05:00Z'),
    })

    expect(result.status).toBe('confirmed')
    expect(mockedPrisma.desktopProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'account-123' },
        create: expect.objectContaining({ accountId: 'account-123', agentAddress: '0xagent123' }),
        update: expect.objectContaining({ agentAddress: '0xagent123' }),
      }),
    )
  })

  it('stores only token hash metadata on DesktopProfile when confirming a device session', async () => {
    const now = new Date('2026-04-12T10:05:00Z')
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
      .mockResolvedValueOnce({ status: 'pending', accountId: null })
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      accountId: 'account-123',
      agentAddress: null,
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: session.expiresAt,
      confirmedAt: now,
      pollIntervalSeconds: 5,
      status: 'confirmed',
    })
    mockedPrisma.desktopProfile.upsert.mockResolvedValue({
      accountId: 'account-123',
    })

    const { completeDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await completeDesktopDeviceSession('ABCD-EFGH', 'account-123', { now })

    expect(result.status).toBe('confirmed')
    const upsertArgs = mockedPrisma.desktopProfile.upsert.mock.calls[0]?.[0]
    expect(upsertArgs).toBeTruthy()
    expect(upsertArgs.create).toEqual(expect.objectContaining({
      accountId: 'account-123',
      desktopAccessTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      desktopAccessTokenIssuedAt: now,
    }))
    expect(upsertArgs.update).toEqual(expect.objectContaining({
      desktopAccessTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      desktopAccessTokenIssuedAt: now,
    }))
    expect(upsertArgs.create).not.toHaveProperty('preferences')
    expect(upsertArgs.update).not.toHaveProperty('preferences')
  })

  it('throws conflict when concurrent request confirmed with different account', async () => {
    const session = {
      id: 'session-1',
      accountId: null,
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      confirmedAt: null,
      pollIntervalSeconds: 5,
      status: 'pending',
    }
    mockedPrisma.desktopDeviceSession.findUnique
      .mockResolvedValueOnce(session) // outer lookup sees pending
      .mockResolvedValueOnce({ status: 'confirmed', accountId: 'account-other' }) // tx re-check: already confirmed by someone else

    const { completeDesktopDeviceSession, DesktopDeviceSessionConflictError } =
      await import('../../web/lib/desktop/device-session')

    await expect(
      completeDesktopDeviceSession('ABCD-EFGH', 'account-123', {
        now: new Date('2026-04-12T10:05:00Z'),
      }),
    ).rejects.toThrow(DesktopDeviceSessionConflictError)
  })

  it('succeeds when concurrent request confirmed with same account', async () => {
    const session = {
      id: 'session-1',
      accountId: null,
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      confirmedAt: null,
      pollIntervalSeconds: 5,
      status: 'pending',
    }
    const confirmedSession = {
      accountId: 'account-123',
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: session.expiresAt,
      confirmedAt: new Date('2026-04-12T10:04:00Z'),
      pollIntervalSeconds: 5,
      status: 'confirmed',
    }
    mockedPrisma.desktopDeviceSession.findUnique
      .mockResolvedValueOnce(session) // outer lookup sees pending
      .mockResolvedValueOnce({ status: 'confirmed', accountId: 'account-123' }) // tx: already confirmed by same account
      .mockResolvedValueOnce(confirmedSession) // tx: re-read for return

    const { completeDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await completeDesktopDeviceSession('ABCD-EFGH', 'account-123', {
      now: new Date('2026-04-12T10:05:00Z'),
    })

    expect(result.status).toBe('confirmed')
  })

  it('returns expired when concurrent poll expires session during complete', async () => {
    const session = {
      id: 'session-1',
      accountId: null,
      deviceCode: 'device-abc',
      userCode: 'ABCD-EFGH',
      expiresAt: new Date('2026-04-12T10:10:00Z'),
      confirmedAt: null,
      pollIntervalSeconds: 5,
      status: 'pending',
    }
    mockedPrisma.desktopDeviceSession.findUnique
      .mockResolvedValueOnce(session) // outer lookup sees pending
      .mockResolvedValueOnce({ status: 'expired', accountId: null }) // tx re-check: concurrent poll expired it

    const { completeDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await completeDesktopDeviceSession('ABCD-EFGH', 'account-123', {
      now: new Date('2026-04-12T10:05:00Z'),
    })

    expect(result.status).toBe('expired')
  })
})
