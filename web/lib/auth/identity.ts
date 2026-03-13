import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { privy } from './privy'

export interface Identity {
  accountId: string
  memberId: string
  kind: 'human' | 'agent'
}

export async function resolveIdentity(): Promise<Identity | null> {
  const headerStore = await headers()
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
