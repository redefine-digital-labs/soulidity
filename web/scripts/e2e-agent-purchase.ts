/**
 * E2E Test: Agent Purchase via Soulidity two-step deferred signing
 *
 * 1. POST /api/agent/souls/{id}/purchase → unsigned txBytes + preparedPurchaseId
 * 2. Sign txBytes locally with agent Ed25519 keypair
 * 3. POST /api/agent/souls/{id}/purchase/execute → submit signature
 * 4. GET /api/agent/souls/{id}/access → verify owner access
 *
 * The server handles quoting, coin selection, and TX building.
 * The agent only signs and submits.
 *
 * Usage:
 *   AGENT_MNEMONIC="..." AGENT_API_KEY="sk-..." SOUL_ID="..." \
 *   [BASE_URL=http://localhost:3100] \
 *   npx tsx web/scripts/e2e-agent-purchase.ts
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { normalizeSuiAddress } from '@mysten/sui/utils'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3100'
const AGENT_MNEMONIC = process.env.AGENT_MNEMONIC
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY // suiprivkey1... format
const AGENT_API_KEY = process.env.AGENT_API_KEY!
const SOUL_ID = process.env.SOUL_ID!

function authHeaders() {
  return {
    'Authorization': `Bearer ${AGENT_API_KEY}`,
    'Content-Type': 'application/json',
    'x-forwarded-for': '127.0.0.1',
  }
}

async function main() {
  if ((!AGENT_MNEMONIC && !AGENT_PRIVATE_KEY) || !AGENT_API_KEY || !SOUL_ID) {
    console.error('Usage: AGENT_MNEMONIC=... (or AGENT_PRIVATE_KEY=suiprivkey1...) AGENT_API_KEY=... SOUL_ID=... npx tsx web/scripts/e2e-agent-purchase.ts')
    process.exit(1)
  }

  const keypair = AGENT_PRIVATE_KEY
    ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(AGENT_PRIVATE_KEY).secretKey)
    : Ed25519Keypair.deriveKeypair(AGENT_MNEMONIC!)
  const agentAddress = normalizeSuiAddress(keypair.toSuiAddress())
  console.log(`Agent address: ${agentAddress}`)
  console.log(`Target: ${BASE_URL}`)

  // Step 1: Prepare purchase TX (server builds TX, returns unsigned bytes)
  console.log('\n--- Step 1: Prepare purchase TX ---')
  const prepRes = await fetch(`${BASE_URL}/api/agent/souls/${encodeURIComponent(SOUL_ID)}/purchase`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  })

  const prepBody = await prepRes.json()
  if (!prepRes.ok) {
    console.error(`Prepare failed (${prepRes.status}):`, prepBody)
    process.exit(1)
  }

  console.log('Prepared purchase:')
  console.log(`  Soul: ${prepBody.context.soulOnChainId}`)
  console.log(`  Price: ${prepBody.context.priceAtomic} atomic`)
  console.log(`  Total: ${prepBody.context.totalAtomic} atomic (incl. fees)`)
  console.log(`  Expires: ${prepBody.context.expiresAt}`)
  console.log(`  TX bytes: ${prepBody.txBytes.length} chars (base64)`)

  // Step 2: Sign TX locally
  console.log('\n--- Step 2: Sign TX ---')
  const txBytes = Buffer.from(prepBody.txBytes, 'base64')
  const { signature } = await keypair.signTransaction(txBytes)
  console.log(`Signature: ${signature.slice(0, 40)}...`)

  // Step 3: Execute signed TX
  console.log('\n--- Step 3: Execute TX ---')
  const execRes = await fetch(`${BASE_URL}/api/agent/souls/${encodeURIComponent(SOUL_ID)}/purchase/execute`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      preparedPurchaseId: prepBody.preparedPurchaseId,
      signature,
    }),
  })

  const execBody = await execRes.json()
  if (!execRes.ok) {
    console.error(`Execute failed (${execRes.status}):`, execBody)
    process.exit(1)
  }

  console.log(`\n✅ Purchase TX confirmed: ${execBody.digest}`)
  console.log(`  Owner: ${execBody.currentOwnerAddress}`)
  console.log(`  Kiosk: ${execBody.currentKioskId}`)
  console.log(`  Status: ${execBody.listingStatus}`)

  // Step 4: Verify access
  console.log('\n--- Step 4: Verify access ---')
  for (let attempt = 1; attempt <= 10; attempt++) {
    await new Promise(r => setTimeout(r, 2000))
    const accessRes = await fetch(`${BASE_URL}/api/agent/souls/${encodeURIComponent(SOUL_ID)}/access`, {
      headers: {
        'Authorization': `Bearer ${AGENT_API_KEY}`,
        'x-forwarded-for': '127.0.0.1',
      },
    })

    if (accessRes.ok) {
      const accessBody = await accessRes.json()
      console.log(`\n✅ Agent access verified (attempt ${attempt})`)
      console.log(`  Access kind: ${accessBody.accessKind}`)
      console.log(`  Policy: ${accessBody.accessPolicy?.functionName}`)
      console.log(`  Blob URL: ${accessBody.artifact?.walrusBlobUrl}`)
      return
    }

    const errBody = await accessRes.json().catch(() => ({}))
    console.log(`  Attempt ${attempt}: ${accessRes.status} — ${errBody.error || 'waiting...'}`)
  }

  console.log('\n⚠️ Access not available after 10 attempts.')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
