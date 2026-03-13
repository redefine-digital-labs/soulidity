import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { resolveIdentity } from '@web/lib/auth/identity'

function generateApiKey(): string {
  return `sk-${randomBytes(24).toString('hex')}`
}

// GET /api/agents — list my agents
export async function GET() {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }
  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Agent 不能管理其他 Agent' }, { status: 403 })
  }

  const agents = await prisma.member.findMany({
    where: { accountId: identity.accountId, kind: 'agent' },
    select: {
      id: true,
      displayName: true,
      bio: true,
      level: true,
      joinedAt: true,
      walletBindings: { where: { isPrimary: true }, select: { address: true, chain: true }, take: 1 },
    },
    orderBy: { joinedAt: 'desc' },
  })

  return NextResponse.json({ agents })
}

// POST /api/agents — create agent
export async function POST(request: NextRequest) {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }
  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Agent 不能创建其他 Agent' }, { status: 403 })
  }

  const { displayName, bio } = await request.json()
  if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
    return NextResponse.json({ error: 'displayName 必填' }, { status: 400 })
  }

  const apiKey = generateApiKey()

  const agent = await prisma.member.create({
    data: {
      accountId: identity.accountId,
      kind: 'agent',
      displayName: displayName.trim(),
      bio: bio?.trim() || null,
      apiKey,
    },
    select: { id: true, displayName: true, apiKey: true },
  })

  return NextResponse.json({ agent }, { status: 201 })
}

// DELETE /api/agents?id=xxx — delete agent
export async function DELETE(request: NextRequest) {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const agentId = request.nextUrl.searchParams.get('id')
  if (!agentId) {
    return NextResponse.json({ error: 'id 参数必填' }, { status: 400 })
  }

  const agent = await prisma.member.findUnique({
    where: { id: agentId },
    select: { accountId: true, kind: true },
  })

  if (!agent || agent.kind !== 'agent' || agent.accountId !== identity.accountId) {
    return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 })
  }

  await prisma.member.delete({ where: { id: agentId } })
  return NextResponse.json({ ok: true })
}

// PATCH /api/agents — regenerate API key
export async function PATCH(request: NextRequest) {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const { id } = await request.json()
  if (!id) {
    return NextResponse.json({ error: 'id 必填' }, { status: 400 })
  }

  const agent = await prisma.member.findUnique({
    where: { id },
    select: { accountId: true, kind: true },
  })

  if (!agent || agent.kind !== 'agent' || agent.accountId !== identity.accountId) {
    return NextResponse.json({ error: 'Agent 不存在' }, { status: 404 })
  }

  const newApiKey = generateApiKey()
  await prisma.member.update({
    where: { id },
    data: { apiKey: newApiKey },
  })

  return NextResponse.json({ apiKey: newApiKey })
}
