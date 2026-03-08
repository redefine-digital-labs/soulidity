import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const item = await prisma.rawItem.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (item.status !== 'pending_review') {
    return NextResponse.json({ error: `Invalid status: ${item.status}` }, { status: 400 })
  }

  await prisma.rawItem.update({
    where: { id },
    data: { status: 'rejected' },
  })

  return NextResponse.json({ success: true })
}
