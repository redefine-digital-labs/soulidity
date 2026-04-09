import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json(
    {
      error: 'Soul allowlist has been retired. Use the Soulidity grant flow in new-web instead.',
    },
    { status: 410 },
  )
}

export async function DELETE() {
  return NextResponse.json(
    {
      error: 'Soul allowlist has been retired. Use the Soulidity grant flow in new-web instead.',
    },
    { status: 410 },
  )
}
