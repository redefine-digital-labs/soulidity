import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { privy } from './privy'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { buildChallengeMessage } from '@web/app/api/auth/challenge/route'

export interface Identity {
  accountId: string
  memberId: string
  kind: 'human' | 'agent'
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
    const member = await prisma.member.findUnique({
      where: { apiKey: token },
      select: { id: true, accountId: true, kind: true },
    })
    if (!member || !member.accountId) return null
    return {
      accountId: member.accountId,
      memberId: member.id,
      kind: member.kind as 'human' | 'agent',
    }
  }

  // Privy token path
  try {
    const claims = await privy.verifyAuthToken(token)
    const account = await prisma.account.findUnique({
      where: { privyDid: claims.userId },
      include: {
        members: {
          where: { kind: 'human' },
          select: { id: true, kind: true },
          take: 1,
        },
      },
    })
    if (!account || account.members.length === 0) return null
    return {
      accountId: account.id,
      memberId: account.members[0].id,
      kind: 'human',
    }
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
