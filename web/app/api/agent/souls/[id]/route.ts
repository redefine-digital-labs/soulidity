import { NextRequest, NextResponse } from 'next/server'
import { requireAgentApiKey } from '@web/lib/auth/require-agent-api-key'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from '@web/lib/souls/repository'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { agent: _agent, response } = await requireAgentApiKey(req)
  if (!_agent) return response

  const { id } = await params
  const soul = await findSoulAssetDetailByRouteId(id)
  if (!soul) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(toSoulAssetDetail(soul, _agent.agentMemberId))
}
