import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json(
    { error: 'Server-side collection image upload is retired. Use wallet-paid browser Walrus upload.' },
    { status: 410 },
  )
}
