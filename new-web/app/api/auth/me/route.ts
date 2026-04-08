import { NextResponse } from 'next/server'
import { prisma } from '@lib/prisma'
import { resolveIdentity } from '@lib/auth/identity'

export const dynamic = 'force-dynamic'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

export async function GET() {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ user: null })
  }

  const [member, account] = await Promise.all([
    prisma.member.findUnique({
      where: { id: identity.memberId },
      select: {
        id: true,
        displayName: true,
        tgName: true,
        avatar: true,
        level: true,
        bio: true,
        handle: true,
        twitterUrl: true,
        websiteUrl: true,
        kind: true,
        walletBindings: {
          where: { chain: 'sui' },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { address: true },
        },
      },
    }),
    prisma.account.findUnique({
      where: { id: identity.accountId },
      select: { email: true },
    }),
  ])

  if (!member) {
    return NextResponse.json({ user: null })
  }

  const isAdmin =
    ADMIN_EMAILS.length > 0 &&
    !!account?.email &&
    ADMIN_EMAILS.includes(account.email.toLowerCase())

  return NextResponse.json({
    user: {
      id: member.id,
      tgName: member.tgName,
      displayName: member.displayName,
      avatar: member.avatar,
      level: member.level,
      bio: member.bio,
      handle: member.handle,
      twitterUrl: member.twitterUrl,
      websiteUrl: member.websiteUrl,
      kind: member.kind,
      primarySuiAddress: member.walletBindings[0]?.address ?? null,
      isAdmin,
    },
  })
}
