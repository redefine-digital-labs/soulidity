import { NextResponse } from 'next/server'
import { hasSealSessionConfig } from '@/lib/services/seal'
import { prisma } from '@/lib/prisma'
import { takeRateLimitToken } from '@/lib/rate-limit'
import { requireAgentWalletIdentity } from '@/lib/soulidity/agent-server'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import { MemoryAccessDeniedError, resolveMemoryAccessPayload } from '@/lib/soulidity/memory-access'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from '@/lib/soulidity/repository'

export const dynamic = 'force-dynamic'

const AGENT_MEMORY_ACCESS_RATE_LIMIT = {
  max: 60,
  windowMs: 60 * 1000,
} as const

function parseEntryKey(value: string) {
  if (!/^\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; entryKey: string }> },
) {
  const auth = await requireAgentWalletIdentity(request)
  if ('error' in auth) return auth.error

  const rateLimit = await takeRateLimitToken(
    `agent-memory-access:${auth.agent.agentMemberId}`,
    AGENT_MEMORY_ACCESS_RATE_LIMIT,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many Soulidity memory access requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  if (!hasSealSessionConfig()) {
    return NextResponse.json({ error: 'Seal session is not configured' }, { status: 503 })
  }

  const { id, entryKey } = await params
  const timestampKey = parseEntryKey(entryKey)
  if (timestampKey == null) {
    return NextResponse.json({ error: 'entryKey must be a decimal timestamp key' }, { status: 400 })
  }

  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const entry = await prisma.soulMemoryEntry.findFirst({
    where: {
      soulOnChainId: soul.onChainId,
      memoryOnChainId: soul.memoryOnChainId,
      timestampKey: BigInt(timestampKey),
    },
    select: {
      id: true,
      soulOnChainId: true,
      memoryOnChainId: true,
      timestampKey: true,
      writerAddress: true,
      writerKind: true,
      blobObjectId: true,
      blobId: true,
      sealSidecar: true,
      createdAtMs: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!entry) {
    return NextResponse.json({ error: 'Memory entry not found' }, { status: 404 })
  }

  try {
    const payload = await resolveMemoryAccessPayload({
      soul: toSoulAssetDetail(soul, {
        viewerMemberId: auth.agent.agentMemberId,
        viewerAddresses: auth.walletAddresses,
        quote: null,
      }),
      entry: {
        id: entry.id,
        soulOnChainId: entry.soulOnChainId,
        memoryOnChainId: entry.memoryOnChainId,
        timestampKey: Number(entry.timestampKey),
        writerAddress: entry.writerAddress,
        writerKind: entry.writerKind === 'founder' ? 'founder' : entry.writerKind === 'granted-agent' ? 'granted-agent' : 'owner',
        blobObjectId: entry.blobObjectId,
        blobId: entry.blobId,
        sealSidecar: entry.sealSidecar as never,
        createdAtMs: Number(entry.createdAtMs),
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      },
      viewerAddresses: auth.walletAddresses,
      packageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'),
    })
    return NextResponse.json(payload)
  } catch (error) {
    if (error instanceof MemoryAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[agent-memory-access] Failed to resolve Soulidity memory access payload', {
      agentMemberId: auth.agent.agentMemberId,
      soulId: soul.onChainId,
      timestampKey,
      error,
    })
    return NextResponse.json({ error: 'Failed to prepare agent memory access payload' }, { status: 500 })
  }
}
