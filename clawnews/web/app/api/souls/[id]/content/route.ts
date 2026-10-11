import { NextResponse } from 'next/server'
import { findContentVersionsByRouteId } from '@/lib/soulidity/repository'
import { parseContentKindParam, parseContentLimitParam } from '@/lib/soulidity/content-route'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const url = new URL(request.url)
  const kind = parseContentKindParam(url.searchParams.get('kind'))
  if (kind == null) {
    return NextResponse.json({ error: 'kind must be a content kind id or known kind name' }, { status: 400 })
  }

  const { id } = await params
  const result = await findContentVersionsByRouteId(id, kind, {
    name: url.searchParams.get('name'),
    cursor: url.searchParams.get('cursor'),
    limit: parseContentLimitParam(url.searchParams.get('limit')),
  })

  if (!result) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  return NextResponse.json(result)
}
