import { NextResponse } from 'next/server'
import { requireIdentity } from '@web/lib/auth/identity'

export async function POST() {
  const { error } = await requireIdentity()
  if (error) return error

  return NextResponse.json(
    { error: 'Soul purchases are temporarily disabled until verified settlement is fully wired.' },
    { status: 503 },
  )
}
