#!/usr/bin/env tsx
/**
 * One-shot retry for the 3 failed steps in phase2-mainnet-execute-rest.ts:
 *   - §12.6.delete memory v0 (RPC sequence race in last run)
 *   - §12.6.purge memory v0 (depends on delete)
 *   - §12.7.buy with corrected totalAtomic = 1_050_000 (price + 250bps platform + 250bps creator royalty)
 */

import './lib/dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

import { createSuiGrpcCompatClient } from '@soulidity/sdk'
import { decodeEd25519SecretKey } from './lib/keypair'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const m = JSON.parse(readFileSync(resolve(repoRoot, 'packages/soulidity-sdk/src/deployment-manifest.json'), 'utf8'))['mainnet']

if (!m.callablePackageId || !m.originalPackageId) {
  throw new Error('mainnet manifest is missing explicit callable/original package routing')
}
process.env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID = m.callablePackageId
process.env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID = m.originalPackageId
process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID = m.marketConfigV2Id
process.env.NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID = m.kioskRegistryId
process.env.NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID = m.kindRegistryId
process.env.NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID = m.soulTransferPolicyId
process.env.NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID = m.collectionTransferPolicyId
process.env.NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE = m.paymentCoinType

const {
  buildDeleteContentVersionAsOwnerTx,
  buildPurgeContentVersionAsOwnerTx,
} = await import('@soulidity/sdk')
const { buildBuySoulTx } = await import('@soulidity/sdk')
const { KIND_MEMORY, CANONICAL_MEMORY_NAME } = await import('@soulidity/sdk')

const ownerKp = decodeEd25519SecretKey(process.env.MAINNET_DEPLOYER_PRIV_KEY!.trim(), 'MAINNET_DEPLOYER_PRIV_KEY')
const buyerKp = decodeEd25519SecretKey(process.env.PHASE2_BUYER_PRIV_KEY!.trim(), 'PHASE2_BUYER_PRIV_KEY')

const STATE_ID = '0x4d7411c644fafe3e770804ddd527cab8f023e3e44c4972af8e72245a0e532136'
const CONTENT_ID = '0x5a77726071e481fff1fae9bdc9842949c4fb53ac4f0ed9aef26b0df1ef8b028c'
const KIOSK_ID = '0xe677f1a96d815e6c8ab3e8f39b77b86d829a57b7e6e591c9857c373a20ec8fbf'
const LISTING_ID = '0x74ff19c7347e01238cdb910e36b5e96681fb3ddd87a0328bffa3d0b6981956be'

const client = createSuiGrpcCompatClient('mainnet')

async function exec(label: string, txFactory: () => Promise<{ tx: import('@mysten/sui/transactions').Transaction; signer: import('@mysten/sui/keypairs/ed25519').Ed25519Keypair }>) {
  try {
    const { tx, signer } = await txFactory()
    const res = await client.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: { showEffects: true },
    })
    if (res.effects?.status?.status === 'success') {
      console.log(`✓ ${label} — digest=${res.digest}`)
    } else {
      console.log(`✗ ${label} — ${res.effects?.status?.error}`)
    }
  } catch (e) {
    console.log(`✗ ${label} — ${(e as Error).message}`)
  }
}

// §12.6.purge (delete already succeeded on prior run)
await exec('§12.6.purge memory v0', async () => ({
  tx: buildPurgeContentVersionAsOwnerTx({
    contentObjectId: CONTENT_ID,
    stateObjectId: STATE_ID,
    kindRegistryObjectId: m.kindRegistryId,
    kind: KIND_MEMORY,
    name: CANONICAL_MEMORY_NAME,
    versionIndex: 0,
  }),
  signer: ownerKp,
}))

// §12.7.buy with corrected total
const buyerUsdcRes = await client.getCoins({
  owner: buyerKp.toSuiAddress(),
  coinType: m.paymentCoinType,
  limit: 1,
})
const buyerUsdc = buyerUsdcRes.data[0]?.coinObjectId
if (!buyerUsdc) {
  console.log(`✗ §12.7.buy — buyer has no USDC`)
} else {
  await exec('§12.7.buy soul (total=1_050_000, reuse buyer kiosk)', async () => ({
    tx: buildBuySoulTx({
      sellerKioskId: KIOSK_ID,
      stateObjectId: STATE_ID,
      listingObjectId: LISTING_ID,
      totalAtomic: 1_050_000n,
      paymentCoinObjectIds: [buyerUsdc],
      buyerKioskId: '0x4db8732719cfb7bb10d4991e943b44f87222be2331bcc1312f0880b84b314931',
      buyerKioskCapOnChainId: '0x2b5f93703a89846205d2144df6565772588f855d99c8be2456ab48dd6fdf4b10',
    }),
    signer: buyerKp,
  }))
}
