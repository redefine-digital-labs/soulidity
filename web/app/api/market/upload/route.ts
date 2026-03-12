import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getSession } from '@web/lib/auth/session'
import { createSupabaseAdmin } from '@web/lib/supabase/server'

const MAX_BUNDLE_SIZE = 50 * 1024 * 1024 // 50MB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_BUNDLE_TYPES = ['application/zip', 'application/x-zip-compressed']
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const fileType = formData.get('type') as string | null // 'bundle' or 'preview'

  if (!file || !fileType) {
    return NextResponse.json({ error: 'Missing file or type' }, { status: 400 })
  }

  const isBundle = fileType === 'bundle'
  const maxSize = isBundle ? MAX_BUNDLE_SIZE : MAX_IMAGE_SIZE
  const allowedTypes = isBundle ? ALLOWED_BUNDLE_TYPES : ALLOWED_IMAGE_TYPES

  if (file.size > maxSize) {
    return NextResponse.json({ error: `File too large (max ${maxSize / 1024 / 1024}MB)` }, { status: 400 })
  }
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: `Invalid file type: ${file.type}` }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const hash = createHash('sha256').update(buffer).digest('hex')
  const ext = file.name.split('.').pop() || (isBundle ? 'zip' : 'png')
  const storagePath = `${session.memberId}/${Date.now()}-${hash.slice(0, 8)}.${ext}`

  const bucket = isBundle ? 'agent-bundles' : 'agent-previews'
  const supabase = createSupabaseAdmin()
  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false })

  if (error) {
    return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 })
  }

  // For previews, return public URL so images render directly
  let returnPath = storagePath
  if (!isBundle) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath)
    returnPath = data.publicUrl
  }

  return NextResponse.json({
    storagePath: returnPath,
    contentHash: isBundle ? hash : undefined,
    size: file.size,
  })
}
