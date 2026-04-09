/**
 * E2E Test: Agent Self-Purchase Flow
 *
 * 1. Ensure the agent wallet has enough test USDC for payment and enough SUI for gas
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
import { getRequiredE2EPaymentCoinType } from '@web/lib/souls/e2e-agent-purchase-config'
import { getRequiredSoulPurchaseFunding, getRequiredSoulPurchaseTopUpAmount } from '@web/lib/souls/e2e-agent-purchase'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const AGENT_MNEMONIC = process.env.AGENT_MNEMONIC!
const AGENT_API_KEY = process.env.AGENT_API_KEY!
const SOUL_ID = process.env.SOUL_ID! // DB UUID or onChainId
const PAYMENT_COIN_TYPE = getRequiredE2EPaymentCoinType()

const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' })

function getPaymentCoinSymbol(coinType: string) {
  const parts = coinType.split('::')
  return parts.at(-1) ?? 'payment coin'
}

async function getRequiredPurchaseBalance() {
  const detailRes = await fetch(`${BASE_URL}/api/souls/${encodeURIComponent(SOUL_ID)}`)
  const detailBody = await detailRes.json().catch(() => null)

  if (!detailRes.ok) {
    throw new Error(`Unable to load Soul detail for funding quote (${detailRes.status})`)
  }
  if (detailBody === null) {
    throw new Error('Soul detail response was not valid JSON')
  }

  return getRequiredSoulPurchaseFunding(detailBody)
}

function readChildProcessFailure(error: unknown) {
  if (!error || typeof error !== 'object') {
    return 'Unknown child process failure'
  }

  const details = [
    'stderr' in error ? error.stderr : null,
    'stdout' in error ? error.stdout : null,
    'message' in error ? error.message : null,
  ].filter((value): value is string | Buffer => typeof value === 'string' || value instanceof Buffer)

  return details.map((value) => value.toString()).find((value) => value.trim().length > 0) ?? 'Unknown child process failure'
}

async function transferGas(recipientAddress: string, requiredGasBalanceMist: bigint) {
  console.log(`\n--- Funding agent wallet ${recipientAddress} ---`)

  const { execFileSync } = await import('node:child_process')
  const balance = await suiClient.getBalance({ owner: recipientAddress })
  const currentBalanceMist = BigInt(balance.totalBalance)
  const topUpAmountMist = getRequiredSoulPurchaseTopUpAmount({
    requiredGasBalanceMist,
    currentBalanceMist,
  })

  if (topUpAmountMist === 0n) {
    console.log(`Agent already has ${balance.totalBalance} MIST, required ${requiredGasBalanceMist} MIST; skipping gas transfer`)
    return
  }

  console.log(`Agent balance ${balance.totalBalance} MIST, topping up ${topUpAmountMist} MIST to reach ${requiredGasBalanceMist} MIST`)

  try {
    const output = execFileSync('sui', [
      'client',
      'transfer-sui',
      '--to', recipientAddress,
      '--sui-coin-object-id', 'gas',
      '--amount', topUpAmountMist.toString(),
      '--gas-budget', '10000000',
      '--json',
    ], { encoding: 'utf-8' })
    const json = JSON.parse(output)
    console.log(`Gas TX: ${json.digest}`)
    await suiClient.waitForTransaction({ digest: json.digest })
    console.log('Gas transfer confirmed')
  } catch {
    // May fail if no gas object, try pay-sui instead
    console.log('Direct transfer failed, trying pay-sui...')
    try {
      const output2 = execFileSync('sui', [
        'client',
        'pay-sui',
        '--recipients', recipientAddress,
        '--amounts', topUpAmountMist.toString(),
        '--gas-budget', '10000000',
        '--json',
      ], { encoding: 'utf-8' })
      const json2 = JSON.parse(output2)
      console.log(`Gas TX: ${json2.digest}`)
      await suiClient.waitForTransaction({ digest: json2.digest })
    } catch (err2) {
      throw new Error(`Unable to fund agent wallet with SUI gas: ${readChildProcessFailure(err2)}`)
    }
  }
}

async function assertPaymentCoinBalance(recipientAddress: string, paymentTotalAtomic: bigint) {
  const paymentCoinSymbol = getPaymentCoinSymbol(PAYMENT_COIN_TYPE)
  const balance = await suiClient.getBalance({ owner: recipientAddress, coinType: PAYMENT_COIN_TYPE })
  const currentBalance = BigInt(balance.totalBalance)

  if (currentBalance < paymentTotalAtomic) {
    throw new Error(
      `Insufficient ${paymentCoinSymbol} balance. Required ${paymentTotalAtomic} atomic units, available ${balance.totalBalance}.`,
    )
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
  console.log(
    `Required payment: ${funding.paymentTotalAtomic} ${getPaymentCoinSymbol(PAYMENT_COIN_TYPE)} atomic units `
    + `(price ${funding.priceAtomic} + platform ${funding.platformFeeAtomic} + creator ${funding.creatorRoyaltyAtomic})`,
  )
  console.log(`Required SUI gas reserve: ${funding.requiredGasBalanceMist} MIST`)
  await assertPaymentCoinBalance(agentAddress, funding.paymentTotalAtomic)
  await transferGas(agentAddress, funding.requiredGasBalanceMist)

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
      console.log(`  Cap: ${accessBody.accessPolicy?.soulAllowlistCapObjectId ?? 'owner-direct'}`)
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
