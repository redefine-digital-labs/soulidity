import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { privy } from '@web/lib/auth/privy'
import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function POST() {
  const headerStore = await headers()
  const authHeader = headerStore.get('authorization')
  if (!authHeader) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const token = authHeader.replace('Bearer ', '')

  let claims
  try {
    claims = await privy.verifyAuthToken(token)
  } catch {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 })
  }

  const privyDid = claims.userId

  // Already linked?
  const existing = await prisma.account.findUnique({
    where: { privyDid },
    include: { members: { where: { kind: 'human' }, select: { id: true }, take: 1 } },
  })
  if (existing && existing.members.length > 0) {
    return NextResponse.json({ linked: true, memberId: existing.members[0].id })
  }

  // Get TG info from Privy user
  const privyUser = await privy.getUser(privyDid)
  const tgAccount = privyUser.telegram
  if (!tgAccount) {
    return NextResponse.json(
      { error: 'account_not_found', message: '请先通过 OpenClaw skill 的邀请流程加入社区' },
      { status: 403 }
    )
  }

  const tgId = String(tgAccount.telegramUserId)

  // Find account by tgId (from backfill) and link privyDid
  const account = await prisma.account.findUnique({
    where: { tgId },
    include: { members: { where: { kind: 'human' }, select: { id: true }, take: 1 } },
  })

  if (!account || account.members.length === 0) {
    return NextResponse.json(
      { error: 'account_not_found', message: '请先通过 OpenClaw skill 的邀请流程加入社区' },
      { status: 403 }
    )
  }

  // Link privyDid
  await prisma.account.update({
    where: { id: account.id },
    data: {
      privyDid,
      tgName: tgAccount.username ?? account.tgName,
    },
  })

  return NextResponse.json({ linked: true, memberId: account.members[0].id })
}
