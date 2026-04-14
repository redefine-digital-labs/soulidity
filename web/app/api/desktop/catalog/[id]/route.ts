import { NextResponse } from 'next/server'
import { findDesktopPersonaManifestById } from '@/lib/desktop/repository'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const manifest = await findDesktopPersonaManifestById(id)

  if (!manifest) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(manifest)
}
