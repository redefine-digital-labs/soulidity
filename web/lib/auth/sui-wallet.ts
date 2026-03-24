import { prisma } from '@web/lib/prisma'

const SUI_WALLET_BINDING_ORDER = [
  { isPrimary: 'desc' as const },
  { createdAt: 'asc' as const },
  { id: 'asc' as const },
]

export async function getMemberSuiWalletAddresses(memberId: string): Promise<string[]> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      walletBindings: {
        where: { chain: 'sui' },
        orderBy: SUI_WALLET_BINDING_ORDER,
        select: { address: true },
      },
    },
  })

  return member?.walletBindings.map((binding) => binding.address) ?? []
}

export async function getMemberPrimarySuiWalletAddress(memberId: string): Promise<string | null> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      walletBindings: {
        where: { chain: 'sui' },
        orderBy: SUI_WALLET_BINDING_ORDER,
        take: 1,
        select: { address: true },
      },
    },
  })

  return member?.walletBindings[0]?.address ?? null
}
