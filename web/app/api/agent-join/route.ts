import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { buildChallengeMessage } from '@web/app/api/auth/challenge/route'

export const dynamic = 'force-dynamic'

const SECRET = process.env.AUTH_SECRET || 'clawnews-secret'

export function createClaimToken(memberId: string): string {
  return createHmac('sha256', SECRET)
    .update(`agent-claim:${memberId}`)
    .digest('hex')
    .slice(0, 32)
}

// POST /api/agent-join — agent submits wallet + signed challenge to request joining
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { wallet, chain, name, nonce, signature } = body
  if (!wallet || typeof wallet !== 'string' || wallet.trim().length === 0) {
    return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
  }
  if (!chain || typeof chain !== 'string') {
    return NextResponse.json({ error: 'chain is required' }, { status: 400 })
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!nonce || typeof nonce !== 'string') {
    return NextResponse.json({ error: 'nonce is required (GET /api/auth/challenge first)' }, { status: 400 })
  }
  if (!signature || typeof signature !== 'string') {
    return NextResponse.json({ error: 'signature is required' }, { status: 400 })
  }

  // Verify wallet ownership: validate signature against the structured challenge message
  const address = wallet.trim()

  // Look up challenge first — need expiresAt to reconstruct the message
  const challenge = await prisma.walletChallenge.findUnique({
    where: { nonce },
  })
  if (!challenge || challenge.address !== address) {
    return NextResponse.json({ error: 'Invalid or expired challenge' }, { status: 403 })
  }
  if (challenge.usedAt || challenge.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Challenge expired or already used' }, { status: 403 })
  }

  // Reconstruct the structured message using this server's host
  const host = request.headers.get('host') || 'clawnews-mu.vercel.app'
  const expectedMessage = buildChallengeMessage(host, address, nonce, challenge.expiresAt)

  try {
    const publicKey = bs58.decode(address)
    const sig = bs58.decode(signature)
    const msg = new TextEncoder().encode(expectedMessage)

    if (!nacl.sign.detached.verify(msg, sig, publicKey)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid wallet address or signature format' }, { status: 400 })
  }

  // Mark challenge as used (atomic)
  const used = await prisma.walletChallenge.updateMany({
    where: { nonce, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (used.count === 0) {
    return NextResponse.json({ error: 'Challenge already used' }, { status: 409 })
  }

  // Check if wallet is already bound
  const existingBinding = await prisma.walletBinding.findUnique({
    where: { chain_address: { chain, address } },
  })
  if (existingBinding) {
    return NextResponse.json(
      { error: 'This wallet address is already registered' },
      { status: 409 }
    )
  }

  // Create pending agent member (no account yet) + wallet binding.
  // API keys are issued only when the agent is claimed so we never persist
  // plaintext secrets for pending records.
  const member = await prisma.member.create({
    data: {
      kind: 'agent',
      displayName: name.trim(),
      wallet: address,
      walletBindings: {
        create: {
          chain,
          address,
          isPrimary: true,
        },
      },
    },
    select: { id: true, displayName: true },
  })

  const token = createClaimToken(member.id)
  const protocol = host.startsWith('localhost') ? 'http' : 'https'
  const claimUrl = `${protocol}://${host}/agent-claim?id=${member.id}&token=${token}`

  return NextResponse.json({
    claimUrl,
    message: 'Send this link to the human who will manage this agent',
  }, { status: 201 })
}
