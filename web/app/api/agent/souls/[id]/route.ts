import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { isUuid } from '@web/lib/is-uuid'
import { serializeSoulPreviewImages } from '@web/lib/souls/serialization'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { agent: _agent, response } = await requireAgentApiKey(req)
  if (!_agent) return response

  const { id } = await params
  const where = isUuid(id)
    ? { OR: [{ id }, { onChainId: id }], status: 'active' as const }
    : { onChainId: id, status: 'active' as const }

  const series = await prisma.soulSeries.findFirst({
    where,
    select: {
      id: true,
      onChainId: true,
      name: true,
      description: true,
      category: true,
      tags: true,
      previewImages: true,
      readme: true,
      oneTimePriceUsdc: true,
      subPriceUsdc: true,
      subPeriodDays: true,
      latestRelease: {
        select: {
          id: true,
          onChainId: true,
          version: true,
          contentHash: true,
          createdAt: true,
        },
      },
      releases: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          onChainId: true,
          version: true,
          contentHash: true,
          createdAt: true,
        },
      },
    },
  })

  if (!series) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(serializeSoulPreviewImages(series))
}
