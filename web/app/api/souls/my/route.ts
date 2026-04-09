import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    {
      error: 'Legacy web Soul portfolio has been retired. Use /new-web/my-souls for Soulidity state.',
    },
    { status: 410 },
  )
}
