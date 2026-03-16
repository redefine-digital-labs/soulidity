import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { createInviteCodeRecord } from '@shared/invite-code-record'

export async function GET() {
  const invites = await prisma.inviteCode.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json(invites)
}

export async function POST() {
  const code = await createInviteCodeRecord(prisma)
  return NextResponse.json({ code })
}
