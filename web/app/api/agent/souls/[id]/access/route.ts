import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { isUuid } from '@web/lib/is-uuid'
import {
  getSealSessionPerpetual,
  getSealSessionSubscription,
  hasSealSessionConfig,
} from '@web/lib/services/seal'
import { getBlobUrl, normalizeWalrusBlobId } from '@web/lib/services/walrus'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { agent, response } = await requireAgentApiKey(req)
  if (!agent) return response

  const { id } = await params
  const where = isUuid(id)
    ? { OR: [{ id }, { onChainId: id }], status: 'active' as const }
    : { onChainId: id, status: 'active' as const }

  const series = await prisma.soulSeries.findFirst({
    where,
    include: {
      releases: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  if (!series) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Check if agent has a grant on any pass for this series
  const agentMember = await prisma.member.findFirst({
    where: { id: agent.agentMemberId },
    include: {
      walletBindings: { where: { chain: 'sui' }, orderBy: { isPrimary: 'desc' }, take: 1 },
    },
  })

  const agentAddress = agentMember?.walletBindings[0]?.address
  if (!agentAddress) {
    return NextResponse.json({ error: 'Agent has no Sui wallet binding' }, { status: 403 })
  }

  const now = new Date()
  const pass = await prisma.soulPassSnapshot.findFirst({
    where: {
      seriesId: series.id,
      agentGrant: agentAddress,
      status: 'active',
      // Exclude expired subscriptions so a valid perpetual can still match
      NOT: {
        passType: 'subscription',
        expiresAt: { lt: now },
      },
    },
    orderBy: [
      { passType: 'desc' },    // subscription (latest release) before perpetual (locked release)
      { expiresAt: 'desc' },   // latest expiry first among subscriptions
      { createdAt: 'desc' },   // most recent first as tiebreaker
    ],
  })

  if (!pass) {
    return NextResponse.json({ error: 'No active pass with agent grant' }, { status: 403 })
  }

  // Resolve the correct release based on pass type
  let targetRelease: typeof series.releases[0] | undefined

  if (pass.passType === 'perpetual') {
    if (!pass.lockedReleaseId) {
      return NextResponse.json({ error: 'Locked release missing for perpetual pass' }, { status: 404 })
    }

    // Perpetual pass: serve the locked release, not the latest
    const lockedRelease = await prisma.soulRelease.findFirst({
      where: { onChainId: pass.lockedReleaseId, seriesId: series.id },
    })
    if (!lockedRelease) {
      return NextResponse.json({ error: 'Locked release not found' }, { status: 404 })
    }
    targetRelease = lockedRelease
  }

  // Subscription passes get the latest release
  if (!targetRelease) {
    targetRelease = series.releases[0]
  }

  if (!targetRelease) {
    return NextResponse.json({ error: 'No releases available' }, { status: 404 })
  }

  const walrusBlobRef = normalizeWalrusBlobId(targetRelease.walrusBlobRef)
  if (!walrusBlobRef) {
    return NextResponse.json({ error: 'Release blob reference is invalid' }, { status: 500 })
  }
  if (!hasSealSessionConfig()) {
    return NextResponse.json({ error: 'Seal session is not configured' }, { status: 503 })
  }

  const sealParams =
    pass.passType === 'perpetual'
      ? getSealSessionPerpetual(series.onChainId)
      : getSealSessionSubscription(series.onChainId)

  return NextResponse.json({
    walrusBlobUrl: getBlobUrl(walrusBlobRef),
    walrusBlobRef,
    releaseId: targetRelease.onChainId,
    version: targetRelease.version,
    contentHash: targetRelease.contentHash,
    sealParams,
    passType: pass.passType,
    passOnChainId: pass.onChainId,
  })
}
