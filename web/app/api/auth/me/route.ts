import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { getSession } from '@web/lib/auth/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ user: null })
  }

  const member = await prisma.member.findUnique({
    where: { id: session.memberId },
    select: { id: true, tgName: true, avatar: true, level: true, bio: true },
  })

  if (!member) {
    return NextResponse.json({ user: null })
  }

  return NextResponse.json({ user: member })
}
