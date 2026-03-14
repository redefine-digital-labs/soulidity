import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireIdentity } from '@web/lib/auth/identity'
import { createClaimToken } from '../route'

export const dynamic = 'force-dynamic'

// GET /api/agent-join/claim?id=xxx&token=xxx — fetch pending agent info
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  const token = request.nextUrl.searchParams.get('token')

  if (!id || !token) {
    return NextResponse.json({ error: 'id and token are required' }, { status: 400 })
  }

  if (createClaimToken(id) !== token) {
    return NextResponse.json({ error: 'Invalid claim link' }, { status: 403 })
  }

  const member = await prisma.member.findUnique({
    where: { id },
    select: {
      id: true,
      displayName: true,
      kind: true,
      accountId: true,
      walletBindings: {
        where: { isPrimary: true },
        select: { address: true, chain: true },
        take: 1,
      },
    },
  })

  if (!member || member.kind !== 'agent') {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  if (member.accountId) {
    return NextResponse.json({ error: 'Agent already claimed' }, { status: 409 })
  }

  return NextResponse.json({
    agent: {
      id: member.id,
      name: member.displayName,
      wallet: member.walletBindings[0]?.address,
      chain: member.walletBindings[0]?.chain,
    },
  })
}

// POST /api/agent-join/claim — human owner claims agent
export async function POST(request: NextRequest) {
  const { error, identity } = await requireIdentity()
  if (error) return error

  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Only humans can claim agents' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id, token } = body
  if (!id || !token) {
    return NextResponse.json({ error: 'id and token are required' }, { status: 400 })
  }

  if (createClaimToken(id) !== token) {
    return NextResponse.json({ error: 'Invalid claim link' }, { status: 403 })
  }

  const member = await prisma.member.findUnique({
    where: { id },
    select: { id: true, kind: true, accountId: true, apiKey: true },
  })

  if (!member || member.kind !== 'agent') {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  if (member.accountId) {
    return NextResponse.json({ error: 'Agent already claimed' }, { status: 409 })
  }

  // Link agent to the claiming human's account (atomic: only succeeds if still unclaimed)
  const result = await prisma.member.updateMany({
    where: { id, accountId: null },
    data: { accountId: identity.accountId },
  })

  if (result.count === 0) {
    return NextResponse.json({ error: 'Agent already claimed' }, { status: 409 })
  }

  return NextResponse.json({
    ok: true,
    apiKey: member.apiKey,
    message: 'Agent claimed successfully. Use the API key for authentication.',
  })
}
