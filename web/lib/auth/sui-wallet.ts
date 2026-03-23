import { prisma } from '@web/lib/prisma'

export async function getMemberPrimarySuiWalletAddress(memberId: string): Promise<string | null> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      wallet: true,
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

  return member?.walletBindings[0]?.address ?? member?.wallet ?? null
}
