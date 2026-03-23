import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  member: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

describe('getMemberPrimarySuiWalletAddress', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('queries Sui wallet bindings with deterministic primary-first ordering', async () => {
    mockedPrisma.member.findUnique.mockResolvedValue({
      walletBindings: [{ address: '0xprimary' }],
    })

    const { getMemberPrimarySuiWalletAddress } = await import('../../web/lib/auth/sui-wallet.ts')
    await expect(getMemberPrimarySuiWalletAddress('member-1')).resolves.toBe('0xprimary')

    expect(mockedPrisma.member.findUnique).toHaveBeenCalledWith({
      where: { id: 'member-1' },
      select: {
        walletBindings: {
          where: { chain: 'sui' },
          orderBy: [
            { isPrimary: 'desc' },
            { createdAt: 'asc' },
            { id: 'asc' },
          ],
          take: 1,
          select: { address: true },
        },
      },
    })
  })

  it('returns null when no Sui binding exists', async () => {
    mockedPrisma.member.findUnique.mockResolvedValue({
      walletBindings: [],
    })

    const { getMemberPrimarySuiWalletAddress } = await import('../../web/lib/auth/sui-wallet.ts')
    await expect(getMemberPrimarySuiWalletAddress('member-1')).resolves.toBeNull()
  })

  it('returns null when the member record is missing', async () => {
    mockedPrisma.member.findUnique.mockResolvedValue(null)

    const { getMemberPrimarySuiWalletAddress } = await import('../../web/lib/auth/sui-wallet.ts')
    await expect(getMemberPrimarySuiWalletAddress('member-1')).resolves.toBeNull()
  })
})
