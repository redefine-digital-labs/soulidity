import { NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'

export const dynamic = 'force-dynamic'

export async function PATCH() {
  const { error } = await requireIdentity()
  if (error) return error
  // TODO: Implement Seal metadata update when client-side Seal encryption is integrated.
  // For now, release bundles are uploaded directly to Walrus without Seal envelope encryption.
  return NextResponse.json({ error: 'Seal metadata update is not yet implemented' }, { status: 501 })
}
