import { NextResponse } from 'next/server'

export async function POST() {
  // Privy handles logout client-side. This endpoint exists for compatibility.
  return NextResponse.json({ ok: true })
}
