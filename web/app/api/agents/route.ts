import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { resolveIdentity } from '@web/lib/auth/identity'
import { takeRateLimitToken } from '@web/lib/rate-limit'
import { buildAgentApiKeyData, generateApiKey } from '@web/lib/auth/resolve-agent'
import { isUuid } from '@web/lib/is-uuid'

const AGENT_CREATE_RATE_LIMIT = {
  max: 5,
  windowMs: 60 * 60 * 1000,
} as const
const MAX_AGENTS_PER_ACCOUNT = 20
const MAX_AGENT_DISPLAY_NAME_LENGTH = 100
const MAX_AGENT_BIO_LENGTH = 500

async function readJsonBody(request: NextRequest): Promise<
  | { body: Record<string, unknown>; error: null }
  | { body: null; error: NextResponse }
> {
  try {
    const body = (await request.json()) as Record<string, unknown>
    return { body, error: null }
  } catch {
    return {
      body: null,
      error: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
    }
  }
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

  const parsedBody = await readJsonBody(request)
  if (parsedBody.error) {
    return parsedBody.error
  }

  const { displayName, bio } = parsedBody.body
  const normalizedDisplayName = typeof displayName === 'string' ? displayName.trim() : ''
  if (!normalizedDisplayName) {
    return NextResponse.json({ error: 'displayName 必填' }, { status: 400 })
  }
  if (normalizedDisplayName.length > MAX_AGENT_DISPLAY_NAME_LENGTH) {
    return NextResponse.json(
      { error: `displayName 不能超过 ${MAX_AGENT_DISPLAY_NAME_LENGTH} 个字符` },
      { status: 400 },
    )
  }
  if (bio != null && typeof bio !== 'string') {
    return NextResponse.json({ error: 'bio 格式无效' }, { status: 400 })
  }

  const normalizedBio = bio?.trim() || null
  if (normalizedBio && normalizedBio.length > MAX_AGENT_BIO_LENGTH) {
    return NextResponse.json(
      { error: `bio 不能超过 ${MAX_AGENT_BIO_LENGTH} 个字符` },
      { status: 400 },
    )
  }

  const createRateLimit = await takeRateLimitToken(
    `agents-create:${identity.accountId}`,
    AGENT_CREATE_RATE_LIMIT,
  )
  if (createRateLimit.limited) {
    return NextResponse.json(
      { error: '请求过于频繁，请稍后再试' },
      {
        status: 429,
        headers: {
          'Retry-After': String(createRateLimit.retryAfterSeconds),
        },
      },
    )
  }

  const existingAgentCount = await prisma.member.count({
    where: { accountId: identity.accountId, kind: 'agent' },
  })
  if (existingAgentCount >= MAX_AGENTS_PER_ACCOUNT) {
    return NextResponse.json(
      { error: `每个账号最多只能创建 ${MAX_AGENTS_PER_ACCOUNT} 个 Agent` },
      { status: 409 },
    )
  }

  const apiKey = generateApiKey()

  const agent = await prisma.member.create({
    data: {
      accountId: identity.accountId,
      kind: 'agent',
      displayName: normalizedDisplayName,
      bio: normalizedBio,
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
  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Agent 不能管理其他 Agent' }, { status: 403 })
  }

  const agentId = request.nextUrl.searchParams.get('id')
  if (!agentId) {
    return NextResponse.json({ error: 'id 参数必填' }, { status: 400 })
  }
  if (!isUuid(agentId)) {
    return NextResponse.json({ error: 'id 格式无效' }, { status: 400 })
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

      const [postCount, soulSeriesCount, soulPassCount] = await Promise.all([
        tx.post.count({ where: { memberId: agentId } }),
        tx.soulSeries.count({ where: { authorMemberId: agentId } }),
        tx.soulPassSnapshot.count({ where: { ownerMemberId: agentId } }),
      ])

      if (postCount > 0 || soulSeriesCount > 0 || soulPassCount > 0) {
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
  if (identity.kind !== 'human') {
    return NextResponse.json({ error: 'Agent 不能管理其他 Agent' }, { status: 403 })
  }

  const parsedBody = await readJsonBody(request)
  if (parsedBody.error) {
    return parsedBody.error
  }

  const { id } = parsedBody.body
  if (!id) {
    return NextResponse.json({ error: 'id 必填' }, { status: 400 })
  }
  if (typeof id !== 'string' || !isUuid(id)) {
    return NextResponse.json({ error: 'id 格式无效' }, { status: 400 })
  }

  const rateLimit = await takeRateLimitToken(`agents-regenerate:${identity.accountId}:${id}`, {
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
