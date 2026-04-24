import { prisma } from '@/lib/prisma'

const SUI_WALLET_BINDING_ORDER = [
  { isPrimary: 'desc' as const },
  { createdAt: 'asc' as const },
  { id: 'asc' as const },
]

export class MultipleSuiWalletBindingsError extends Error {
  constructor(message = 'Multiple Sui wallets are not supported for this account') {
    super(message)
    this.name = 'MultipleSuiWalletBindingsError'
  }
}

async function getOrderedSuiWalletAddresses(memberId: string): Promise<string[]> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      walletBindings: {
        where: { chain: 'sui' },
        orderBy: SUI_WALLET_BINDING_ORDER,
        take: 2,
        select: { address: true },
      },
    },
  })

  const addresses = member?.walletBindings.map((binding) => binding.address) ?? []
  if (addresses.length > 1) {
    throw new MultipleSuiWalletBindingsError()
  }

  return addresses
}

export async function getMemberSuiWalletAddresses(memberId: string): Promise<string[]> {
  return getOrderedSuiWalletAddresses(memberId)
}

export async function getMemberPrimarySuiWalletAddress(memberId: string): Promise<string | null> {
  const addresses = await getOrderedSuiWalletAddresses(memberId)
  return addresses[0] ?? null
}
