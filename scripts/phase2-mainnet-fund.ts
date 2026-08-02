#!/usr/bin/env tsx
/**
 * scripts/phase2-mainnet-fund.ts
 *
 * Phase 2 mainnet smoke — fund ephemeral buyer + agent wallets from the
 * test deployer.
 *
 * Reads from env (.env / .env.local):
 *   MAINNET_DEPLOYER_PRIV_KEY  — funder
 *   PHASE2_BUYER_PRIV_KEY           — buyer wallet (gets SUI + USDC)
 *   PHASE2_AGENT_PRIV_KEY           — agent wallet (gets SUI only)
 *
 * Funding amounts (one-time):
 *   buyer: 0.5 SUI + 3 USDC (covers §12.4 + §12.7 + §12.9 buyer flows)
 *   agent: 0.3 SUI (gas-only; agent receives grants, doesn't initiate buys)
 *
 * Usage:
 *   npm run phase2:fund            # dry-run (prints intended transfers)
 *   npm run phase2:fund -- --apply # actually transfer
 */

import './lib/dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createSuiGrpcCompatClient } from '@soulidity/sdk'
import { Transaction } from '@mysten/sui/transactions'

import { decodeEd25519SecretKey } from './lib/keypair'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SUI_BUYER_FUND = 500_000_000n // 0.5 SUI
const SUI_AGENT_FUND = 300_000_000n // 0.3 SUI
const USDC_BUYER_FUND = 3_000_000n // 3 USDC (atomic, 6 decimals)
const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

const apply = process.argv.includes('--apply')
if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log('phase2-mainnet-fund.ts — see file header for usage')
  process.exit(0)
}

const network = (process.env.NEXT_PUBLIC_SUI_NETWORK?.trim() || 'mainnet') as 'mainnet' | 'testnet'
if (network !== 'mainnet') {
  console.error(`This script is mainnet-only; NEXT_PUBLIC_SUI_NETWORK=${network}`)
  process.exit(1)
}

const funderRaw = process.env.MAINNET_DEPLOYER_PRIV_KEY?.trim()
if (!funderRaw) {
  console.error('MAINNET_DEPLOYER_PRIV_KEY missing')
  process.exit(1)
}
const funderKp = decodeEd25519SecretKey(funderRaw, 'MAINNET_DEPLOYER_PRIV_KEY')
const funderAddr = funderKp.toSuiAddress()

const buyerRaw = process.env.PHASE2_BUYER_PRIV_KEY?.trim()
const agentRaw = process.env.PHASE2_AGENT_PRIV_KEY?.trim()
if (!buyerRaw && !agentRaw) {
  console.error('Neither PHASE2_BUYER_PRIV_KEY nor PHASE2_AGENT_PRIV_KEY set — nothing to fund')
  process.exit(1)
}
const buyerAddr = buyerRaw ? decodeEd25519SecretKey(buyerRaw, 'PHASE2_BUYER_PRIV_KEY').toSuiAddress() : null
const agentAddr = agentRaw ? decodeEd25519SecretKey(agentRaw, 'PHASE2_AGENT_PRIV_KEY').toSuiAddress() : null

console.log('━━━ Phase 2 mainnet funding ━━━')
console.log(`funder : ${funderAddr}`)
console.log(`buyer  : ${buyerAddr ?? '(skipped)'}`)
console.log(`agent  : ${agentAddr ?? '(skipped)'}`)
console.log(`mode   : ${apply ? 'EXECUTE' : 'dry-run'}`)
console.log()

const suiClient = createSuiGrpcCompatClient('mainnet')

const tx = new Transaction()
tx.setSender(funderAddr)

// SUI transfers via splitCoins on the gas coin
const suiSplits: bigint[] = []
const suiRecipients: string[] = []
if (buyerAddr) {
  suiSplits.push(SUI_BUYER_FUND)
  suiRecipients.push(buyerAddr)
}
if (agentAddr) {
  suiSplits.push(SUI_AGENT_FUND)
  suiRecipients.push(agentAddr)
}
const suiCoins = tx.splitCoins(tx.gas, suiSplits.map((amt) => tx.pure.u64(amt)))
for (let i = 0; i < suiRecipients.length; i++) {
  tx.transferObjects([suiCoins[i]!], tx.pure.address(suiRecipients[i]!))
}

// USDC transfer to buyer (need to find a USDC coin owned by funder, split, transfer)
if (buyerAddr) {
  const usdcCoins = await suiClient.getCoins({ owner: funderAddr, coinType: USDC_TYPE, limit: 50 })
  if (usdcCoins.data.length === 0) {
    console.error('✗ funder has no USDC coins on mainnet')
    if (apply) process.exit(1)
  } else {
    // Use the first coin (or merge if needed)
    const [primary, ...rest] = usdcCoins.data
    const primaryArg = tx.object(primary!.coinObjectId)
    if (rest.length > 0) {
      tx.mergeCoins(primaryArg, rest.map((c) => tx.object(c.coinObjectId)))
    }
    const [usdcSplit] = tx.splitCoins(primaryArg, [tx.pure.u64(USDC_BUYER_FUND)])
    tx.transferObjects([usdcSplit!], tx.pure.address(buyerAddr))
  }
}

console.log('Plan:')
if (buyerAddr) console.log(`  → buyer  ${buyerAddr}: ${Number(SUI_BUYER_FUND) / 1e9} SUI + ${Number(USDC_BUYER_FUND) / 1e6} USDC`)
if (agentAddr) console.log(`  → agent  ${agentAddr}: ${Number(SUI_AGENT_FUND) / 1e9} SUI`)
console.log()

if (!apply) {
  // Dry-run: build + simulate
  const bytes = await tx.build({ client: suiClient as never })
  const dr = await suiClient.dryRunTransactionBlock({ transactionBlock: bytes })
  console.log(`dryRun status : ${dr.effects.status.status}`)
  if (dr.effects.status.error) console.log(`dryRun error  : ${dr.effects.status.error}`)
  console.log(`dryRun gas    : ${Number(dr.effects.gasUsed.computationCost) + Number(dr.effects.gasUsed.storageCost)} MIST`)
  console.log('\n[dry-run] Re-run with --apply to execute.')
  process.exit(0)
}

const res = await suiClient.signAndExecuteTransaction({
  signer: funderKp,
  transaction: tx,
  options: { showEffects: true },
})
if (res.effects?.status?.status !== 'success') {
  console.error(`✗ transfer failed: ${res.effects?.status?.error}`)
  process.exit(2)
}
console.log(`✓ funded — digest=${res.digest}`)
