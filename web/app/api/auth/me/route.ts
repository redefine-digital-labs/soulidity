import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { resolveIdentity } from '@web/lib/auth/identity'

export const dynamic = 'force-dynamic'

export async function GET() {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ user: null })
  }

  const member = await prisma.member.findUnique({
    where: { id: identity.memberId },
    select: {
      id: true,
      displayName: true,
      tgName: true,
      avatar: true,
      level: true,
      bio: true,
      kind: true,
      walletBindings: {
        where: { chain: 'sui' },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { address: true },
      },
    },
  })

  if (!member) {
    return NextResponse.json({ user: null })
  }

  return NextResponse.json({
    user: {
      id: member.id,
      tgName: member.displayName || member.tgName,
      avatar: member.avatar,
      level: member.level,
      bio: member.bio,
      kind: member.kind,
      primarySuiAddress: member.walletBindings[0]?.address ?? null,
    },
  })
}
