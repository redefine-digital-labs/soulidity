import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Server-side Soul upload is retired. Use wallet-paid browser Walrus upload with cost confirmation.' },
    { status: 410 },
  )
}
