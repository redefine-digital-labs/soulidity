import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  walletBinding: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  member: {
    create: vi.fn(),
    update: vi.fn(),
  },
  desktopPet: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  desktopDeviceSession: {
    updateMany: vi.fn(),
  },
}))

vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))

beforeEach(() => {
  vi.resetAllMocks()
  mockedPrisma.desktopDeviceSession.updateMany.mockResolvedValue({ count: 0 })
})

describe('Desktop pet unlink → re-link revives the same agent member', () => {
  it('reuses the same WalletBinding/Member after unlink without violating the unique chain+address constraint', async () => {
    // Simulate post-unlink state: the WalletBinding still exists pointing
    // at the disabled agent member; DesktopPet was deleted; member fields
    // were cleared.
    mockedPrisma.walletBinding.findUnique.mockResolvedValue({
      id: 'binding-1',
      memberId: 'member-existing',
      member: {
        id: 'member-existing',
        accountId: 'account-A',
        kind: 'agent',
      },
    })
    mockedPrisma.member.update.mockResolvedValue({})
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(null)
    mockedPrisma.desktopPet.create.mockResolvedValue({ id: 'pet-revived' })

    const { persistConfirmedDesktopPet } = await import('../../web/lib/desktop/device-session')
    const result = await persistConfirmedDesktopPet(mockedPrisma as any, {
      accountId: 'account-A',
      sessionId: 'session-2',
      deviceCode: 'device-2',
      agentAddress: '0xagent',
      now: new Date('2026-05-07T11:00:00Z'),
    })

    expect(result.agentMemberId).toBe('member-existing')
    // Crucially, no new wallet binding is created — the existing one is reused.
    expect(mockedPrisma.walletBinding.create).not.toHaveBeenCalled()
    // Agent member is flipped back to active and re-keyed.
    expect(mockedPrisma.member.update).toHaveBeenCalledWith({
      where: { id: 'member-existing' },
      data: expect.objectContaining({
        agentStatus: 'active',
        apiKeyHash: expect.any(String),
      }),
    })
    // A fresh DesktopPet row appears for the revived link.
    expect(mockedPrisma.desktopPet.create).toHaveBeenCalled()
  })
})
