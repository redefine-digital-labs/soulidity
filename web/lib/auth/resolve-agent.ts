import { createHash, randomBytes } from 'node:crypto'

import { prisma } from '@/lib/prisma'

export interface AgentIdentity {
  agentMemberId: string
  ownerMemberId: string
  accountId: string
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex')
}

export function generateApiKey(): string {
  return `sk-${randomBytes(24).toString('hex')}`
}

export function buildAgentApiKeyData(apiKey: string) {
  return {
    apiKey: null,
    apiKeyHash: hashApiKey(apiKey),
    agentStatus: 'active',
  }
}

export async function resolveAgentByApiKey(apiKey: string): Promise<AgentIdentity | null> {
  const agent = await prisma.member.findFirst({
    where: {
      apiKeyHash: hashApiKey(apiKey),
      kind: 'agent',
      agentStatus: 'active',
    },
    select: {
      id: true,
      accountId: true,
      account: {
        select: {
          members: {
            where: {
              kind: 'human',
            },
            select: {
              id: true,
            },
            orderBy: [
              { joinedAt: 'asc' },
              { id: 'asc' },
            ],
            take: 1,
          },
        },
      },
    },
  })

  if (!agent?.accountId) {
    return null
  }

  const owner = agent.account?.members[0]

  if (!owner) {
    return null
  }

  return {
    agentMemberId: agent.id,
    ownerMemberId: owner.id,
    accountId: agent.accountId,
  }
}
