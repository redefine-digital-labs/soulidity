import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveIdentity } from '@/lib/auth/identity'
import { isAdminIdentity } from '@/lib/auth/admin-allowlist'

export const dynamic = 'force-dynamic'

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
        coverImage: true,
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

  const primarySuiAddress = member.walletBindings[0]?.address ?? null
  const isAdmin = isAdminIdentity({
    email: account?.email ?? null,
    walletAddress: primarySuiAddress,
  })

  return NextResponse.json({
    user: {
      id: member.id,
      tgName: member.tgName,
      displayName: member.displayName,
      avatar: member.avatar,
      level: member.level,
      bio: member.bio,
      coverImageUrl: member.coverImage,
      handle: member.handle,
      twitterUrl: member.twitterUrl,
      websiteUrl: member.websiteUrl,
      kind: member.kind,
      primarySuiAddress,
      isAdmin,
    },
  })
}
