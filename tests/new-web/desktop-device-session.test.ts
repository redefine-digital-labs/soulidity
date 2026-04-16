import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  desktopDeviceSession: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  desktopProfile: {
    create: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
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

  it('keeps confirmed sessions idempotent across poll retries', async () => {
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
    let status = session.status

    mockedPrisma.desktopDeviceSession.findUnique.mockImplementation(async () => ({
      ...session,
      status,
    }))
    mockedPrisma.desktopDeviceSession.update.mockResolvedValue({
      status: 'confirmed',
      accountId: 'account-123',
      expiresAt: session.expiresAt,
      pollIntervalSeconds: 5,
    })
    mockedPrisma.desktopDeviceSession.updateMany.mockImplementation(async ({ where, data }) => {
      const matchesStatus = where.status ? status === where.status : true
      const matchesId =
        typeof where.id === 'string'
          ? session.id === where.id
          : where.id?.not
            ? session.id !== where.id.not
            : true

      if (matchesStatus && matchesId) {
        if ('status' in data && data.status) {
          status = data.status
        }
        return { count: 1 }
      }

      return { count: 0 }
    })
    mockedPrisma.desktopProfile.create.mockResolvedValue({ accountId: 'account-123' })
    mockedPrisma.desktopProfile.updateMany.mockResolvedValue({ count: 1 })

    const { generateDesktopAccessTokenForDeviceSession } = await import('../../web/lib/desktop/auth')
    const sameSessionHash = generateDesktopAccessTokenForDeviceSession('device-abc').hash
    mockedPrisma.desktopProfile.findUnique.mockResolvedValue({
      desktopAccessTokenHash: sameSessionHash,
    })

    const { pollDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const first = await pollDesktopDeviceSession('device-abc', { now })
    const second = await pollDesktopDeviceSession('device-abc', {
      now: new Date('2026-04-12T10:15:05Z'),
    })

    expect(first.status).toBe('confirmed')
    expect(second.status).toBe('confirmed')
    if (first.status === 'confirmed') {
      expect(first.desktopAccessToken).toMatch(/^dtk_[0-9a-f]{64}$/)
    }
    if (second.status === 'confirmed') {
      expect(second.desktopAccessToken).toMatch(/^dtk_[0-9a-f]{64}$/)
    }
    if (first.status === 'confirmed' && second.status === 'confirmed') {
      expect(second.desktopAccessToken).toBe(first.desktopAccessToken)
    }
    expect(mockedPrisma.desktopDeviceSession.update).toHaveBeenCalledTimes(2)
    expect(mockedPrisma.desktopDeviceSession.updateMany).not.toHaveBeenCalled()
    expect(mockedPrisma.desktopProfile.findUnique).not.toHaveBeenCalled()
    expect(mockedPrisma.desktopProfile.upsert).not.toHaveBeenCalled()
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

  it('rotates desktop credentials and expires older confirmed sessions while browser confirms a device session', async () => {
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
    mockedPrisma.desktopDeviceSession.updateMany.mockResolvedValue({ count: 1 })
    mockedPrisma.desktopProfile.findUnique.mockResolvedValue({
      desktopAccessTokenHash: 'legacy-session-hash',
    })
    mockedPrisma.desktopProfile.upsert.mockResolvedValue({ accountId: 'account-123' })

    const { generateDesktopAccessTokenForDeviceSession } = await import('../../web/lib/desktop/auth')
    const { completeDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await completeDesktopDeviceSession('ABCD-EFGH', 'account-123', { now })

    expect(result.status).toBe('confirmed')
    const expectedHash = generateDesktopAccessTokenForDeviceSession('device-abc').hash
    expect(mockedPrisma.desktopProfile.findUnique).toHaveBeenCalledWith({
      where: { accountId: 'account-123' },
      select: { desktopAccessTokenHash: true },
    })
    expect(mockedPrisma.desktopProfile.upsert).toHaveBeenCalledWith({
      where: { accountId: 'account-123' },
      create: {
        accountId: 'account-123',
        agentAddress: '0xagent123',
        desktopAccessTokenHash: expectedHash,
        desktopAccessTokenIssuedAt: now,
      },
      update: {
        agentAddress: '0xagent123',
        desktopAccessTokenHash: expectedHash,
        desktopAccessTokenIssuedAt: now,
      },
    })
    expect(mockedPrisma.desktopDeviceSession.updateMany).toHaveBeenCalledWith({
      where: {
        accountId: 'account-123',
        status: 'confirmed',
        id: { not: 'session-1' },
      },
      data: {
        status: 'expired',
      },
    })
    expect(result).not.toHaveProperty('desktopAccessToken')
  })

  it('fills an existing blank desktop profile row during browser confirmation instead of waiting for first poll', async () => {
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
    mockedPrisma.desktopDeviceSession.updateMany.mockResolvedValue({ count: 0 })
    mockedPrisma.desktopProfile.findUnique.mockResolvedValue({
      desktopAccessTokenHash: null,
    })
    mockedPrisma.desktopProfile.upsert.mockResolvedValue({ accountId: 'account-123' })

    const { generateDesktopAccessTokenForDeviceSession } = await import('../../web/lib/desktop/auth')
    const { completeDesktopDeviceSession } = await import('../../web/lib/desktop/device-session')
    const result = await completeDesktopDeviceSession('ABCD-EFGH', 'account-123', { now })

    expect(result.status).toBe('confirmed')
    const expectedHash = generateDesktopAccessTokenForDeviceSession('device-abc').hash
    const upsertArgs = mockedPrisma.desktopProfile.upsert.mock.calls[0]?.[0]
    expect(upsertArgs?.update).toEqual({
      desktopAccessTokenHash: expectedHash,
      desktopAccessTokenIssuedAt: now,
    })
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
