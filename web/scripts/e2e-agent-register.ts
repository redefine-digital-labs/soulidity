/**
 * E2E Test: Agent Registration Flow
 *
 * Steps:
 *   1. GET /api/agent-join?address=... → challenge
 *   2. Sign the challenge message with Agent keypair
 *   3. POST /api/agent-join → claimUrl
 *
 * Usage: npx tsx scripts/e2e-agent-register.ts
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { normalizeSuiAddress } from '@mysten/sui/utils'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const AGENT_MNEMONIC = process.env.AGENT_MNEMONIC ?? 'razor world ship bulb joke worry expire adapt whisper card glow have'
const AGENT_NAME = process.env.AGENT_NAME ?? 'Agent Alpha (E2E)'

async function main() {
  // Derive keypair from mnemonic
  const keypair = Ed25519Keypair.deriveKeypair(AGENT_MNEMONIC)
  const address = normalizeSuiAddress(keypair.toSuiAddress())
  console.log(`Agent address: ${address}`)

  // Step 1: GET challenge
  console.log('\n--- Step 1: Request challenge ---')
  const challengeRes = await fetch(`${BASE_URL}/api/agent-join?address=${address}`, {
    headers: { 'x-forwarded-for': '127.0.0.1' },
  })
  if (!challengeRes.ok) {
    const err = await challengeRes.text()
    throw new Error(`Challenge failed (${challengeRes.status}): ${err}`)
  }
  const { nonce, message, expiresAt } = await challengeRes.json()
  console.log(`Nonce: ${nonce}`)
  console.log(`ExpiresAt: ${expiresAt}`)
  console.log(`Message:\n${message}`)

  // Step 2: Sign message
  console.log('\n--- Step 2: Sign challenge ---')
  const messageBytes = new TextEncoder().encode(message)
  const { signature } = await keypair.signPersonalMessage(messageBytes)
  console.log(`Signature: ${signature.slice(0, 40)}...`)

  // Step 3: POST registration
  console.log('\n--- Step 3: Register agent ---')
  const registerRes = await fetch(`${BASE_URL}/api/agent-join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
    },
    body: JSON.stringify({
      wallet: address,
      chain: 'sui',
      name: AGENT_NAME,
      nonce,
      signature,
    }),
  })

  const registerBody = await registerRes.json()
  console.log(`Status: ${registerRes.status}`)
  console.log(`Response:`, JSON.stringify(registerBody, null, 2))

  if (registerRes.status === 201) {
    console.log('\n✅ Agent registered successfully!')
    console.log(`Claim URL: ${registerBody.claimUrl}`)

    // Extract id and token from claimUrl
    const url = new URL(registerBody.claimUrl)
    const memberId = url.searchParams.get('id')
    const token = url.searchParams.get('token')
    console.log(`\nMember ID: ${memberId}`)
    console.log(`Claim Token: ${token}`)
    console.log(`\nNext step: Claim agent via POST /api/agent-join/claim with Privy auth`)
  } else {
    console.log('\n❌ Registration failed')
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
