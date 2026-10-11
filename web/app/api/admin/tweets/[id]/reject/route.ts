import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin({ mutation: req })
  if (error) return error

  const { id } = await params

  const item = await prisma.rawItem.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (item.status !== 'pending_review') {
    return NextResponse.json({ error: `Invalid status: ${item.status}` }, { status: 400 })
  }

  // Atomically reject only if still pending — prevents approve/reject races
  const claimed = await prisma.rawItem.updateMany({
    where: { id, status: 'pending_review' },
    data: { status: 'rejected' },
  })
  if (claimed.count === 0) {
    return NextResponse.json({ error: 'Item already claimed by another action' }, { status: 409 })
  }

  return NextResponse.json({ success: true })
}
