import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireIdentity } from '@web/lib/auth/identity'
import { isUuid } from '@web/lib/is-uuid'

function notFoundResponse() {
  return NextResponse.json({ error: 'Not found or not owner' }, { status: 404 })
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ passId: string }> },
) {
  const { error, identity } = await requireIdentity()
  if (error) return error

  const { passId } = await params
  if (!isUuid(passId)) {
    return notFoundResponse()
  }

  const pass = await prisma.soulPassSnapshot.findUnique({ where: { id: passId } })
  if (!pass || pass.ownerMemberId !== identity.memberId) {
    return notFoundResponse()
  }

  return NextResponse.json(
    { error: 'Agent grant changes must be finalized on-chain before they can be mirrored here' },
    { status: 501 },
  )
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ passId: string }> },
) {
  const { error, identity } = await requireIdentity()
  if (error) return error

  const { passId } = await params
  if (!isUuid(passId)) {
    return notFoundResponse()
  }

  const pass = await prisma.soulPassSnapshot.findUnique({ where: { id: passId } })
  if (!pass || pass.ownerMemberId !== identity.memberId) {
    return notFoundResponse()
  }

  return NextResponse.json(
    { error: 'Agent grant changes must be finalized on-chain before they can be mirrored here' },
    { status: 501 },
  )
}
