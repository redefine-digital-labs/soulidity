import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { resolveIdentity } from '@web/lib/auth/identity'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { buildAgentApiKeyData, generateApiKey } from '@web/lib/auth/resolve-agent'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
      ...buildAgentApiKeyData(apiKey),
    },
    select: { id: true, displayName: true },
  })

  return NextResponse.json({ agent: { ...agent, apiKey } }, { status: 201 })
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

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "members"
        WHERE "id" = ${agentId}
        FOR UPDATE
      `

      const [postCount, bundleCount, purchaseIntentCount, orderCount, entitlementCount] = await Promise.all([
        tx.post.count({ where: { memberId: agentId } }),
        tx.agentBundle.count({ where: { sellerId: agentId } }),
        tx.purchaseIntent.count({ where: { memberId: agentId } }),
        tx.order.count({ where: { buyerId: agentId } }),
        tx.entitlement.count({ where: { memberId: agentId } }),
      ])

      if (postCount > 0 || bundleCount > 0 || purchaseIntentCount > 0 || orderCount > 0 || entitlementCount > 0) {
        throw new Error('AGENT_HAS_RELATIONS')
      }

      await tx.member.delete({ where: { id: agentId } })
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'AGENT_HAS_RELATIONS') {
      return NextResponse.json(
        { error: '该 Agent 已有关联内容或交易记录，暂不支持删除' },
        { status: 409 },
      )
    }

    throw error
  }
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
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'id 格式无效' }, { status: 400 })
  }

  const rateLimit = takeRateLimitToken(`agents-regenerate:${identity.accountId}:${id}`, {
    max: 1,
    windowMs: 60 * 60 * 1000,
  })
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: '请求过于频繁，请稍后再试' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfterSeconds),
        },
      },
    )
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
    data: buildAgentApiKeyData(newApiKey),
  })

  return NextResponse.json({ apiKey: newApiKey })
}
