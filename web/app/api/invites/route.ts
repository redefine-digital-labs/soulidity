import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { createInviteCodeRecord } from '@shared/invite-code-record'
import { requireAdmin } from '@web/lib/auth/admin'

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const invites = await prisma.inviteCode.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
  return NextResponse.json(invites)
}

export async function POST() {
  const { error } = await requireAdmin()
  if (error) return error

  const code = await createInviteCodeRecord(prisma)
  return NextResponse.json({ code })
}
