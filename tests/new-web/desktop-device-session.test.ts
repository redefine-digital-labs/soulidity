import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    desktopDeviceSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockPrisma,
}))

import {
  pollDesktopDeviceSession,
  startDesktopDeviceSession,
} from '../../web/lib/desktop/device-session'

describe('startDesktopDeviceSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates and returns a pending device session with generated codes', async () => {
    const expiresAt = new Date('2026-04-10T04:00:00.000Z')

    mockPrisma.desktopDeviceSession.create.mockResolvedValue({
      deviceCode: 'device-code-123',
      userCode: 'ABCD-EFGH',
      expiresAt,
      pollIntervalSeconds: 5,
    })

    const result = await startDesktopDeviceSession()

    expect(mockPrisma.desktopDeviceSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deviceCode: expect.any(String),
        userCode: expect.stringMatching(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
        status: 'pending',
        pollIntervalSeconds: 5,
        expiresAt: expect.any(Date),
      }),
      select: {
        deviceCode: true,
        userCode: true,
        expiresAt: true,
        pollIntervalSeconds: true,
      },
    })

    expect(result).toEqual({
      deviceCode: 'device-code-123',
      userCode: 'ABCD-EFGH',
      expiresAt: '2026-04-10T04:00:00.000Z',
      pollInterval: 5,
    })
  })
})

describe('pollDesktopDeviceSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns invalid_code when the device code does not exist', async () => {
    mockPrisma.desktopDeviceSession.findUnique.mockResolvedValue(null)

    const result = await pollDesktopDeviceSession('missing-device-code')

    expect(mockPrisma.desktopDeviceSession.findUnique).toHaveBeenCalledWith({
      where: { deviceCode: 'missing-device-code' },
      select: expect.objectContaining({
        id: true,
        accountId: true,
        deviceCode: true,
        expiresAt: true,
        pollIntervalSeconds: true,
        status: true,
      }),
    })
    expect(result).toEqual({
      status: 'invalid_code',
      expiresAt: null,
      pollInterval: 5,
    })
  })

  it('keeps a live pending session pending while recording the latest poll time', async () => {
    const expiresAt = new Date('2026-04-10T04:05:00.000Z')

    mockPrisma.desktopDeviceSession.findUnique.mockResolvedValue({
      id: 'session-1',
      accountId: null,
      deviceCode: 'device-code-123',
      expiresAt,
      pollIntervalSeconds: 7,
      status: 'pending',
    })
    mockPrisma.desktopDeviceSession.update.mockResolvedValue({
      status: 'pending',
      accountId: null,
      expiresAt,
      pollIntervalSeconds: 7,
    })

    const result = await pollDesktopDeviceSession('device-code-123', {
      now: new Date('2026-04-10T04:00:00.000Z'),
    })

    expect(mockPrisma.desktopDeviceSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: {
        lastPolledAt: new Date('2026-04-10T04:00:00.000Z'),
      },
      select: {
        status: true,
        accountId: true,
        expiresAt: true,
        pollIntervalSeconds: true,
      },
    })
    expect(result).toEqual({
      status: 'pending',
      expiresAt: '2026-04-10T04:05:00.000Z',
      pollInterval: 7,
    })
  })

  it('expires a pending session once its expiry has passed', async () => {
    const expiresAt = new Date('2026-04-10T03:55:00.000Z')

    mockPrisma.desktopDeviceSession.findUnique.mockResolvedValue({
      id: 'session-2',
      accountId: null,
      deviceCode: 'device-code-expired',
      expiresAt,
      pollIntervalSeconds: 5,
      status: 'pending',
    })
    mockPrisma.desktopDeviceSession.update.mockResolvedValue({
      status: 'expired',
      accountId: null,
      expiresAt,
      pollIntervalSeconds: 5,
    })

    const result = await pollDesktopDeviceSession('device-code-expired', {
      now: new Date('2026-04-10T04:00:00.000Z'),
    })

    expect(mockPrisma.desktopDeviceSession.update).toHaveBeenCalledWith({
      where: { id: 'session-2' },
      data: {
        status: 'expired',
        lastPolledAt: new Date('2026-04-10T04:00:00.000Z'),
      },
      select: {
        status: true,
        accountId: true,
        expiresAt: true,
        pollIntervalSeconds: true,
      },
    })
    expect(result).toEqual({
      status: 'expired',
      expiresAt: '2026-04-10T03:55:00.000Z',
      pollInterval: 5,
    })
  })

  it('returns a confirmed session idempotently on repeated polling', async () => {
    const expiresAt = new Date('2026-04-10T04:05:00.000Z')

    mockPrisma.desktopDeviceSession.findUnique.mockResolvedValue({
      id: 'session-3',
      accountId: 'account-123',
      deviceCode: 'device-code-confirmed',
      expiresAt,
      pollIntervalSeconds: 5,
      status: 'confirmed',
    })
    mockPrisma.desktopDeviceSession.update.mockResolvedValue({
      status: 'confirmed',
      accountId: 'account-123',
      expiresAt,
      pollIntervalSeconds: 5,
    })

    const result = await pollDesktopDeviceSession('device-code-confirmed', {
      now: new Date('2026-04-10T04:01:00.000Z'),
    })

    expect(result).toEqual({
      status: 'confirmed',
      accountId: 'account-123',
      deepLink: null,
      expiresAt: '2026-04-10T04:05:00.000Z',
      pollInterval: 5,
    })
  })
})
