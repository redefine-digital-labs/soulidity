import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Client Blob upload tokens are retired. Upload directly from the browser through wallet-paid Walrus.' },
    { status: 410 },
  )
}
