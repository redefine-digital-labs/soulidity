import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Vercel Blob staging is retired. Upload directly from the browser through wallet-paid Walrus.' },
    { status: 410 },
  )
}
