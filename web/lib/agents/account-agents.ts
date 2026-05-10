import { prisma } from '@/lib/prisma'

export interface AccountAgentTarget {
  memberId: string
  address: string
  displayName: string | null
}

/**
 * Return every active `kind='agent'` member of the account that has a
 * Sui chain wallet binding. Used by the auto-grant-on-append flow to
 * fan out grants to all of an owner's agents in a single PTB.
 *
 * Agents without a Sui binding are skipped (cannot receive a grant
 * keyed by Sui address). Agents with `agentStatus !== 'active'` are
 * skipped to match `resolveAgentByApiKey` semantics — a paused or
 * disabled agent must not silently regain access via auto-grant.
 */
export async function getActiveAgentSuiAddressesForAccount(
  accountId: string,
): Promise<AccountAgentTarget[]> {
  if (!accountId) return []
  const rows = await prisma.member.findMany({
    where: {
      accountId,
      kind: 'agent',
      agentStatus: 'active',
    },
    select: {
      id: true,
      displayName: true,
      walletBindings: {
        where: { chain: 'sui' },
        select: { address: true },
        take: 1,
      },
    },
    orderBy: { joinedAt: 'asc' },
  })
  const targets: AccountAgentTarget[] = []
  for (const row of rows) {
    const address = row.walletBindings[0]?.address
    if (!address) continue
    targets.push({
      memberId: row.id,
      address,
      displayName: row.displayName,
    })
  }
  return targets
}
