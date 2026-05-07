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

const NOW = new Date('2026-05-07T10:00:00Z')

beforeEach(() => {
  vi.resetAllMocks()
  mockedPrisma.desktopDeviceSession.updateMany.mockResolvedValue({ count: 0 })
})

async function importPersist() {
  return import('../../web/lib/desktop/device-session')
}

describe('persistConfirmedDesktopPet', () => {
  it('Branch 1: creates Member + WalletBinding + DesktopPet for a fresh address', async () => {
    mockedPrisma.walletBinding.findUnique.mockResolvedValue(null)
    mockedPrisma.member.create.mockResolvedValue({ id: 'member-new' })
    mockedPrisma.walletBinding.create.mockResolvedValue({})
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(null)
    mockedPrisma.desktopPet.create.mockResolvedValue({ id: 'pet-1' })

    const { persistConfirmedDesktopPet } = await importPersist()
    const result = await persistConfirmedDesktopPet(mockedPrisma as any, {
      accountId: 'account-A',
      sessionId: 'session-1',
      deviceCode: 'device-abc',
      agentAddress: '0xagent',
      now: NOW,
    })

    expect(result.desktopPetId).toBe('pet-1')
    expect(result.agentMemberId).toBe('member-new')
    expect(mockedPrisma.member.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'account-A',
        kind: 'agent',
        agentStatus: 'active',
        apiKey: null,
        apiKeyHash: expect.any(String),
        apiKeyRotationId: null,
        pendingApiKeyHash: null,
      }),
      select: { id: true },
    })
    expect(mockedPrisma.walletBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memberId: 'member-new',
        chain: 'sui',
        address: '0xagent',
      }),
    })
    expect(mockedPrisma.desktopPet.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'account-A',
        agentAddress: '0xagent',
        agentMemberId: 'member-new',
        label: 'Desktop pet',
      }),
      select: { id: true },
    })
  })

  it('Branch 2: reuses same-account agent member, refreshes hash, clears rotation fields', async () => {
    mockedPrisma.walletBinding.findUnique.mockResolvedValue({
      id: 'binding-1',
      memberId: 'member-existing',
      member: { id: 'member-existing', accountId: 'account-A', kind: 'agent' },
    })
    mockedPrisma.member.update.mockResolvedValue({})
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(null)
    mockedPrisma.desktopPet.create.mockResolvedValue({ id: 'pet-revived' })

    const { persistConfirmedDesktopPet } = await importPersist()
    const result = await persistConfirmedDesktopPet(mockedPrisma as any, {
      accountId: 'account-A',
      sessionId: 'session-1',
      deviceCode: 'device-abc',
      agentAddress: '0xagent',
      now: NOW,
    })

    expect(result.agentMemberId).toBe('member-existing')
    expect(mockedPrisma.member.create).not.toHaveBeenCalled()
    expect(mockedPrisma.walletBinding.create).not.toHaveBeenCalled()
    expect(mockedPrisma.member.update).toHaveBeenCalledWith({
      where: { id: 'member-existing' },
      data: expect.objectContaining({
        agentStatus: 'active',
        apiKey: null,
        apiKeyHash: expect.any(String),
        apiKeyRotationId: null,
        pendingApiKeyHash: null,
        pendingApiKeyRotationId: null,
        pendingApiKeyRotationExpiresAt: null,
      }),
    })
  })

  it('Branch 3: throws DesktopPetAddressConflictError when binding belongs to another account agent', async () => {
    mockedPrisma.walletBinding.findUnique.mockResolvedValue({
      id: 'binding-1',
      memberId: 'member-other',
      member: { id: 'member-other', accountId: 'account-OTHER', kind: 'agent' },
    })

    const { persistConfirmedDesktopPet, DesktopPetAddressConflictError } = await importPersist()
    await expect(
      persistConfirmedDesktopPet(mockedPrisma as any, {
        accountId: 'account-A',
        sessionId: 'session-1',
        deviceCode: 'device-abc',
        agentAddress: '0xagent',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DesktopPetAddressConflictError)
    expect(mockedPrisma.member.update).not.toHaveBeenCalled()
    expect(mockedPrisma.member.create).not.toHaveBeenCalled()
  })

  it('Branch 4: throws DesktopPetAddressConflictError when binding belongs to a human member', async () => {
    mockedPrisma.walletBinding.findUnique.mockResolvedValue({
      id: 'binding-1',
      memberId: 'member-human',
      member: { id: 'member-human', accountId: 'account-A', kind: 'human' },
    })

    const { persistConfirmedDesktopPet, DesktopPetAddressConflictError } = await importPersist()
    await expect(
      persistConfirmedDesktopPet(mockedPrisma as any, {
        accountId: 'account-A',
        sessionId: 'session-1',
        deviceCode: 'device-abc',
        agentAddress: '0xagent',
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DesktopPetAddressConflictError)
  })

  it('Branch 5: existing pet for (accountId, agentAddress) refreshes hash without duplicate row', async () => {
    mockedPrisma.walletBinding.findUnique.mockResolvedValue({
      id: 'binding-1',
      memberId: 'member-existing',
      member: { id: 'member-existing', accountId: 'account-A', kind: 'agent' },
    })
    mockedPrisma.member.update.mockResolvedValue({})
    mockedPrisma.desktopPet.findUnique.mockResolvedValue({
      id: 'pet-existing',
      label: 'Custom pet name',
    })
    mockedPrisma.desktopPet.update.mockResolvedValue({ id: 'pet-existing' })

    const { persistConfirmedDesktopPet } = await importPersist()
    const result = await persistConfirmedDesktopPet(mockedPrisma as any, {
      accountId: 'account-A',
      sessionId: 'session-1',
      deviceCode: 'device-abc',
      agentAddress: '0xagent',
      now: NOW,
    })

    expect(result.desktopPetId).toBe('pet-existing')
    expect(mockedPrisma.desktopPet.create).not.toHaveBeenCalled()
    expect(mockedPrisma.desktopPet.update).toHaveBeenCalledWith({
      where: { id: 'pet-existing' },
      data: expect.objectContaining({
        agentMemberId: 'member-existing',
        desktopAccessTokenHash: expect.any(String),
        desktopAccessTokenIssuedAt: NOW,
      }),
      select: { id: true },
    })
    // Label is not overwritten by the persist path.
    const updateArgs = mockedPrisma.desktopPet.update.mock.calls[0]?.[0]
    expect(updateArgs?.data?.label).toBeUndefined()
  })

  it('handles UniqueViolation race by re-reading and updating the winning pet row', async () => {
    mockedPrisma.walletBinding.findUnique.mockResolvedValue(null)
    mockedPrisma.member.create.mockResolvedValue({ id: 'member-new' })
    mockedPrisma.walletBinding.create.mockResolvedValue({})
    mockedPrisma.desktopPet.findUnique
      .mockResolvedValueOnce(null) // initial check
      .mockResolvedValueOnce({ id: 'pet-race' }) // re-read after race
    const uniqueErr: any = new Error('Unique violation')
    uniqueErr.code = 'P2002'
    mockedPrisma.desktopPet.create.mockRejectedValue(uniqueErr)
    mockedPrisma.desktopPet.update.mockResolvedValue({ id: 'pet-race' })

    const { persistConfirmedDesktopPet } = await importPersist()
    const result = await persistConfirmedDesktopPet(mockedPrisma as any, {
      accountId: 'account-A',
      sessionId: 'session-1',
      deviceCode: 'device-abc',
      agentAddress: '0xagent',
      now: NOW,
    })

    expect(result.desktopPetId).toBe('pet-race')
    expect(mockedPrisma.desktopPet.update).toHaveBeenCalledWith({
      where: { id: 'pet-race' },
      data: expect.objectContaining({
        agentMemberId: 'member-new',
        desktopAccessTokenHash: expect.any(String),
      }),
      select: { id: true },
    })
  })

  it('expires only sibling sessions for the same (accountId, agentAddress)', async () => {
    mockedPrisma.walletBinding.findUnique.mockResolvedValue(null)
    mockedPrisma.member.create.mockResolvedValue({ id: 'member-new' })
    mockedPrisma.walletBinding.create.mockResolvedValue({})
    mockedPrisma.desktopPet.findUnique.mockResolvedValue(null)
    mockedPrisma.desktopPet.create.mockResolvedValue({ id: 'pet-1' })

    const { persistConfirmedDesktopPet } = await importPersist()
    await persistConfirmedDesktopPet(mockedPrisma as any, {
      accountId: 'account-A',
      sessionId: 'session-1',
      deviceCode: 'device-abc',
      agentAddress: '0xagent',
      now: NOW,
    })

    expect(mockedPrisma.desktopDeviceSession.updateMany).toHaveBeenCalledWith({
      where: {
        accountId: 'account-A',
        agentAddress: '0xagent',
        status: 'confirmed',
        id: { not: 'session-1' },
      },
      data: { status: 'expired' },
    })
  })
})
