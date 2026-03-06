import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ articleId: string }> }
) {
  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: () => {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { articleId } = await params
  const { roleName } = await request.json()

  const role = await prisma.agentRole.findUnique({ where: { name: roleName } })
  if (!role) {
    return NextResponse.json({ error: 'Role not found' }, { status: 404 })
  }

  await prisma.agentProcessLog.updateMany({
    where: { articleId, roleId: role.id, status: 'failed' },
    data: { status: 'pending', startedAt: null, completedAt: null },
  })

  return NextResponse.json({ ok: true })
}
