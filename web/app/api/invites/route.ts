import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export async function GET() {
  const invites = await prisma.inviteCode.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json(invites)
}

export async function POST() {
  const code = crypto.randomUUID().slice(0, 8).toUpperCase()
  await prisma.inviteCode.create({ data: { code } })
  return NextResponse.json({ code })
}
