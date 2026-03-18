import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { privy } from './privy'
import { resolveAgentByApiKey } from './resolve-agent'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { buildChallengeMessage } from '@web/app/api/auth/challenge/route'
import { isUniqueConstraintError } from '@shared/prisma-errors'

export interface Identity {
  accountId: string
  memberId: string
  ownerMemberId?: string
  kind: 'human' | 'agent'
}

type HumanAccountLookup = { privyDid: string } | { tgId: string } | { email: string }

type HumanAccountIdentityRecord = {
  id: string
  privyDid: string | null
  tgName: string | null
  email: string | null
  members: Array<{
    id: string
    kind: string
  }>
}

async function findHumanAccount(where: HumanAccountLookup): Promise<HumanAccountIdentityRecord | null> {
  return prisma.account.findUnique({
    where,
    include: {
      members: {
        where: { kind: 'human' },
        select: { id: true, kind: true },
        take: 1,
      },
    },
  })
}

function toHumanIdentity(account: HumanAccountIdentityRecord): Identity | null {
  const member = account.members[0]
  if (!member) {
    return null
  }

  return {
    accountId: account.id,
    memberId: member.id,
    kind: 'human',
  }
}

export async function resolvePrivyIdentity(token: string): Promise<Identity | null> {
  const claims = await privy.verifyAuthToken(token)

  const linkedAccount = await findHumanAccount({ privyDid: claims.userId })
  if (linkedAccount) {
    return toHumanIdentity(linkedAccount)
  }

  const privyUser = await privy.getUser(claims.userId)
  const telegramTgId = privyUser.telegram?.telegramUserId
  const tgId = telegramTgId !== undefined && telegramTgId !== null
    ? String(telegramTgId)
    : null
  const email = privyUser.email?.address?.trim().toLowerCase() || null
  const tgName = privyUser.telegram?.username?.trim() || null

  const candidates: HumanAccountLookup[] = []
  if (tgId) {
    candidates.push({ tgId })
  }
  if (email) {
    candidates.push({ email })
  }

  for (const candidate of candidates) {
    const legacyAccount = await findHumanAccount(candidate)
    if (!legacyAccount) {
      continue
    }
    if (legacyAccount.privyDid && legacyAccount.privyDid !== claims.userId) {
      continue
    }

    const updateData: {
      privyDid?: string
      email?: string
      tgName?: string
    } = {}

    if (legacyAccount.privyDid !== claims.userId) {
      updateData.privyDid = claims.userId
    }
    if (email && legacyAccount.email !== email) {
      updateData.email = email
    }
    if (tgName && legacyAccount.tgName !== tgName) {
      updateData.tgName = tgName
    }

    if (Object.keys(updateData).length > 0) {
      try {
        await prisma.account.update({
          where: { id: legacyAccount.id },
          data: updateData,
        })
      } catch (error) {
        if (isUniqueConstraintError(error) && updateData.email) {
          // Email already claimed by another account — link privyDid/tgName
          // without the email so the user can still log in
          const { email: _, ...safeData } = updateData
          if (Object.keys(safeData).length > 0) {
            await prisma.account.update({
              where: { id: legacyAccount.id },
              data: safeData,
            })
          }
        } else {
          throw error
        }
      }
    }

    return toHumanIdentity(legacyAccount)
  }

  return null
}

export async function resolveIdentity(): Promise<Identity | null> {
  const headerStore = await headers()

  // Wallet signature path (for agents)
  const agentAddress = headerStore.get('x-agent-address')
  const agentSignature = headerStore.get('x-agent-signature')
  const agentMessage = headerStore.get('x-agent-message')
  if (agentAddress && agentSignature && agentMessage) {
    return resolveWalletIdentity(agentAddress, agentSignature, agentMessage)
  }

  const authHeader = headerStore.get('authorization')
  if (!authHeader) return null

  const token = authHeader.replace('Bearer ', '')

  // API Key path
  if (token.startsWith('sk-')) {
    const agent = await resolveAgentByApiKey(token)
    if (!agent) return null

    return {
      accountId: agent.accountId,
      memberId: agent.agentMemberId,
      ownerMemberId: agent.ownerMemberId,
      kind: 'agent',
    }
  }

  // Privy token path
  try {
    return await resolvePrivyIdentity(token)
  } catch {
    return null
  }
}

async function resolveWalletIdentity(
  address: string,
  signature: string,
  nonce: string
): Promise<Identity | null> {
  try {
    // Look up the challenge by nonce first — need expiresAt to reconstruct the message
    const challenge = await prisma.walletChallenge.findUnique({
      where: { nonce },
    })
    if (!challenge) return null
    if (challenge.address !== address) return null
    if (challenge.usedAt) return null
    if (challenge.expiresAt < new Date()) return null

    // Reconstruct the structured message using this server's host
    const headerStore = await headers()
    const host = headerStore.get('host') || 'clawnews-mu.vercel.app'
    const expectedMessage = buildChallengeMessage(host, address, nonce, challenge.expiresAt)

    // Verify signature against the reconstructed message
    const publicKey = bs58.decode(address)
    const sig = bs58.decode(signature)
    const msg = new TextEncoder().encode(expectedMessage)

    if (!nacl.sign.detached.verify(msg, sig, publicKey)) {
      return null
    }

    // Mark the challenge as used (atomic: prevents concurrent replay)
    const result = await prisma.walletChallenge.updateMany({
      where: { nonce, usedAt: null },
      data: { usedAt: new Date() },
    })
    if (result.count === 0) return null

    // Find the wallet binding and its member
    const binding = await prisma.walletBinding.findFirst({
      where: { address },
      select: {
        member: {
          select: { id: true, accountId: true, kind: true },
        },
      },
    })
    if (!binding?.member || !binding.member.accountId) return null

    return {
      accountId: binding.member.accountId,
      memberId: binding.member.id,
      kind: binding.member.kind as 'human' | 'agent',
    }
  } catch {
    return null
  }
}

export async function requireIdentity(): Promise<
  { error: NextResponse; identity: null } | { error: null; identity: Identity }
> {
  const identity = await resolveIdentity()
  if (!identity) {
    return {
      error: NextResponse.json({ error: '请先登录' }, { status: 401 }),
      identity: null,
    }
  }
  return { error: null, identity }
}
