import { NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export async function GET() {
  const members = await prisma.member.findMany({ orderBy: { joinedAt: 'desc' } })
  return NextResponse.json(members)
}
