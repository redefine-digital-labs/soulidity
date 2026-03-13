import { NextRequest, NextResponse } from 'next/server'
import { resolveIdentity } from '@web/lib/auth/identity'
import { prisma } from '@web/lib/prisma'
import { createSupabaseAdmin } from '@web/lib/supabase/server'

export async function GET(request: NextRequest) {
  const identity = await resolveIdentity()
  if (!identity) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 })
  }

  const bundleId = request.nextUrl.searchParams.get('bundleId')
  if (!bundleId) {
    return NextResponse.json({ error: 'Missing bundleId' }, { status: 400 })
  }

  const entitlement = await prisma.entitlement.findFirst({
    where: { memberId: identity.memberId, bundleId, status: 'active' },
    include: {
      bundle: { select: { storageBucket: true, storagePath: true, name: true } },
    },
  })
  if (!entitlement) {
    return NextResponse.json({ error: 'No active entitlement for this bundle' }, { status: 403 })
  }

  const supabase = createSupabaseAdmin()
  const { data, error } = await supabase.storage
    .from(entitlement.bundle.storageBucket)
    .createSignedUrl(entitlement.bundle.storagePath, 300)

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 })
  }

  return NextResponse.json({
    downloadUrl: data.signedUrl,
    fileName: `${entitlement.bundle.name}.zip`,
    expiresIn: 300,
  })
}
