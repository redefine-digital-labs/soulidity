import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getSession } from '@web/lib/auth/session'

export async function POST() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nonce = randomBytes(32).toString('hex')
  const message = `Sign this message to bind your Sui wallet to CryptoOpenClaw.\n\nAccount: ${session.memberId}\nNonce: ${nonce}`
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  return NextResponse.json({ nonce, message, expiresAt: expiresAt.toISOString() })
}
