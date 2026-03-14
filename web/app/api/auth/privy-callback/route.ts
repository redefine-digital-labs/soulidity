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

  // Get Privy user info
  const privyUser = await privy.getUser(privyDid)

  // --- Telegram login path ---
  const tgAccount = privyUser.telegram
  if (tgAccount) {
    const tgId = String(tgAccount.telegramUserId)

    const account = await prisma.account.findUnique({
      where: { tgId },
      include: { members: { where: { kind: 'human' }, select: { id: true }, take: 1 } },
    })

    if (account && account.members.length > 0) {
      await prisma.account.update({
        where: { id: account.id },
        data: {
          privyDid,
          tgName: tgAccount.username ?? account.tgName,
        },
      })

      return NextResponse.json({ linked: true, memberId: account.members[0].id })
    }
    // TG account not found — fall through to email path if enabled
  }

  // --- Email login path (dev/testing only) ---
  const emailAddress = privyUser.email?.address?.toLowerCase()
  if (emailAddress && process.env.NEXT_PUBLIC_ENABLE_EMAIL_LOGIN === 'true') {
    // Try find existing account by email
    const byEmail = await prisma.account.findUnique({
      where: { email: emailAddress },
      include: { members: { where: { kind: 'human' }, select: { id: true }, take: 1 } },
    })

    if (byEmail) {
      if (!byEmail.privyDid || byEmail.privyDid !== privyDid) {
        await prisma.account.update({
          where: { id: byEmail.id },
          data: { privyDid },
        })
      }
      if (byEmail.members.length > 0) {
        return NextResponse.json({ linked: true, memberId: byEmail.members[0].id })
      }
      // Account exists but no human member — create one
      const member = await prisma.member.create({
        data: {
          accountId: byEmail.id,
          displayName: emailAddress.split('@')[0],
          kind: 'human',
        },
      })
      return NextResponse.json({ linked: true, memberId: member.id })
    }

    // Auto-create account + member for email users
    const displayName = emailAddress.split('@')[0]
    const newAccount = await prisma.account.create({
      data: {
        privyDid,
        email: emailAddress,
        members: {
          create: {
            displayName,
            kind: 'human',
          },
        },
      },
      include: { members: { select: { id: true }, take: 1 } },
    })

    return NextResponse.json({ linked: true, memberId: newAccount.members[0].id })
  }

  return NextResponse.json(
    { error: 'account_not_found', message: '请先通过 OpenClaw skill 的邀请流程加入社区' },
    { status: 403 }
  )
}
