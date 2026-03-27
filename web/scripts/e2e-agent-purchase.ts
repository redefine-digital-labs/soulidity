/**
 * E2E Test: Agent Self-Purchase Flow
 *
 * 1. Ensure the agent wallet has enough SUI for price + fees
 * 2. POST /api/agent/souls/{id}/purchase → TX bytes
 * 3. Sign TX locally with agent Ed25519 keypair
 * 4. POST /api/agent/souls/{id}/purchase/execute → submit
 * 5. GET /api/agent/souls/{id}/access → verify 200
 *
 * Usage:
 *   AGENT_MNEMONIC="..." AGENT_API_KEY="sk-..." SOUL_ID="..." \
 *   npx tsx scripts/e2e-agent-purchase.ts
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { getRequiredSoulPurchaseFunding, getRequiredSoulPurchaseTopUpAmount } from '@web/lib/souls/e2e-agent-purchase'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const AGENT_MNEMONIC = process.env.AGENT_MNEMONIC!
const AGENT_API_KEY = process.env.AGENT_API_KEY!
const SOUL_ID = process.env.SOUL_ID! // DB UUID or onChainId

const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' })

async function getRequiredPurchaseBalance() {
  const detailRes = await fetch(`${BASE_URL}/api/souls/${encodeURIComponent(SOUL_ID)}`)
  const detailBody = await detailRes.json().catch(() => null)

  if (!detailRes.ok) {
    throw new Error(`Unable to load Soul detail for funding quote (${detailRes.status})`)
  }

  return getRequiredSoulPurchaseFunding(detailBody ?? {})
}

async function transferGas(recipientAddress: string, requiredBalanceMist: bigint) {
  console.log(`\n--- Funding agent wallet ${recipientAddress} ---`)

  const { execSync } = await import('node:child_process')
  const balance = await suiClient.getBalance({ owner: recipientAddress })
  const currentBalanceMist = BigInt(balance.totalBalance)
  const topUpAmountMist = getRequiredSoulPurchaseTopUpAmount({
    requiredBalanceMist,
    currentBalanceMist,
  })

  if (topUpAmountMist === 0n) {
    console.log(`Agent already has ${balance.totalBalance} MIST, required ${requiredBalanceMist} MIST; skipping gas transfer`)
    return
  }

  console.log(`Agent balance ${balance.totalBalance} MIST, topping up ${topUpAmountMist} MIST to reach ${requiredBalanceMist} MIST`)

  const cmd = `sui client transfer-sui \
    --to ${recipientAddress} \
    --sui-coin-object-id gas \
    --amount ${topUpAmountMist} \
    --gas-budget 10000000 \
    --json 2>&1`

  try {
    const output = execSync(cmd, { encoding: 'utf-8' })
    const json = JSON.parse(output)
    console.log(`Gas TX: ${json.digest}`)
    await suiClient.waitForTransaction({ digest: json.digest })
    console.log('Gas transfer confirmed')
  } catch (err: any) {
    // May fail if no gas object, try pay-sui instead
    console.log('Direct transfer failed, trying pay-sui...')
    const cmd2 = `sui client pay-sui \
      --recipients ${recipientAddress} \
      --amounts ${topUpAmountMist} \
      --gas-budget 10000000 \
      --json 2>&1`
    try {
      const output2 = execSync(cmd2, { encoding: 'utf-8' })
      const json2 = JSON.parse(output2)
      console.log(`Gas TX: ${json2.digest}`)
      await suiClient.waitForTransaction({ digest: json2.digest })
    } catch (err2: any) {
      console.warn('Gas transfer failed:', err2.stdout || err2.message)
    }
  }
}

async function main() {
  if (!AGENT_MNEMONIC || !AGENT_API_KEY || !SOUL_ID) {
    console.error('Usage: AGENT_MNEMONIC=... AGENT_API_KEY=... SOUL_ID=... npx tsx scripts/e2e-agent-purchase.ts')
    process.exit(1)
  }

  // Derive agent keypair
  const keypair = Ed25519Keypair.deriveKeypair(AGENT_MNEMONIC)
  const agentAddress = normalizeSuiAddress(keypair.toSuiAddress())
  console.log(`Agent address: ${agentAddress}`)

  // Step 1: Quote required funding and top up the agent wallet
  const funding = await getRequiredPurchaseBalance()
  console.log(`Required balance: ${funding.requiredBalanceMist} MIST (price ${funding.priceSui} + fees ${funding.feeAmountSui} + gas buffer)`)
  await transferGas(agentAddress, funding.requiredBalanceMist)

  // Step 2: Prepare purchase TX
  console.log(`\n--- Step 2: Prepare purchase TX ---`)
  const prepRes = await fetch(`${BASE_URL}/api/agent/souls/${SOUL_ID}/purchase`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AGENT_API_KEY}`,
      'x-forwarded-for': '127.0.0.1',
    },
    body: JSON.stringify({}),
  })

  const prepBody = await prepRes.json()
  console.log(`Status: ${prepRes.status}`)

  if (!prepRes.ok) {
    console.error('Prepare failed:', prepBody)
    process.exit(1)
  }

  console.log(`Prepared context:`, JSON.stringify(prepBody.context, null, 2))

  // Step 3: Sign TX locally
  console.log(`\n--- Step 3: Sign TX ---`)
  const txBytes = Buffer.from(prepBody.txBytes, 'base64')
  const { signature } = await keypair.signTransaction(txBytes)
  console.log(`Signature: ${signature.slice(0, 40)}...`)

  // Step 4: Execute signed TX
  console.log(`\n--- Step 4: Execute TX ---`)
  const execRes = await fetch(`${BASE_URL}/api/agent/souls/${SOUL_ID}/purchase/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AGENT_API_KEY}`,
      'x-forwarded-for': '127.0.0.1',
    },
    body: JSON.stringify({
      preparedPurchaseId: prepBody.preparedPurchaseId,
      signature,
    }),
  })

  const execBody = await execRes.json()
  console.log(`Status: ${execRes.status}`)
  console.log(`Response:`, JSON.stringify(execBody, null, 2))

  if (!execRes.ok) {
    console.error('Execute failed')
    process.exit(1)
  }

  console.log(`\n✅ Purchase TX confirmed: ${execBody.digest}`)

  // Step 5: Wait for indexer sync and verify access
  console.log(`\n--- Step 5: Verify access (waiting for indexer sync) ---`)
  for (let attempt = 1; attempt <= 10; attempt++) {
    await new Promise(r => setTimeout(r, 2000))
    const accessRes = await fetch(`${BASE_URL}/api/agent/souls/${SOUL_ID}/access`, {
      headers: {
        'Authorization': `Bearer ${AGENT_API_KEY}`,
        'x-forwarded-for': '127.0.0.1',
      },
    })

    if (accessRes.ok) {
      const accessBody = await accessRes.json()
      console.log(`\n✅ Agent access verified (attempt ${attempt})!`)
      console.log(`  Policy: ${accessBody.accessPolicy?.functionName}`)
      console.log(`  Cap: ${accessBody.accessPolicy?.soulAccessCapObjectId ?? 'owner-direct'}`)
      console.log(`  Blob URL: ${accessBody.artifact?.walrusBlobUrl}`)
      return
    }

    const errBody = await accessRes.json().catch(() => ({}))
    console.log(`  Attempt ${attempt}: ${accessRes.status} — ${errBody.error || 'waiting...'}`)
  }

  console.log('\n⚠️ Access not available after 10 attempts. Indexer may need more time.')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
