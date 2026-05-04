#!/usr/bin/env tsx
/**
 * Run the 3 scenarios that were skipped in the autonomous run:
 *   - §12.6.append memory v1 to Soul2 (uses fresh walrus blob)
 *   - §12.4.purchase  buyer purchases paid_access on Soul2 sprite
 *                     (configure first at lower price = 500_000 atomic)
 *   - §12.5a          mint Soul3 with public sprite (READ_OWNER|READ_PUBLIC)
 */

import './lib/dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { Transaction } from '@mysten/sui/transactions'

import { decodeEd25519SecretKey } from './lib/keypair'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const m = JSON.parse(readFileSync(resolve(repoRoot, 'packages/soulidity-sdk/src/deployment-manifest.json'), 'utf8'))['mainnet']

process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID = m.packageId
process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID = m.marketConfigId
process.env.NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID = m.kioskRegistryId
process.env.NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID = m.kindRegistryId
process.env.NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID = m.soulTransferPolicyId
process.env.NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID = m.collectionTransferPolicyId
process.env.NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE = m.paymentCoinType

const { buildAppendContentVersionAsOwnerTx } = await import('@soulidity/sdk')
const {
  buildConfigurePaidAccessKindTx,
  buildPurchasePaidAccessTx,
} = await import('@soulidity/sdk')
const { buildPublishSoulTx } = await import('@soulidity/sdk')
const {
  KIND_SOUL_DOC,
  KIND_MEMORY,
  KIND_SKILL,
  KIND_SPRITE,
  CANONICAL_SOUL_DOC_NAME,
  CANONICAL_MEMORY_NAME,
  READ_OWNER,
  READ_GRANT,
  READ_PUBLIC,
} = await import('@soulidity/sdk')
const { SOUL_GRANT_SCOPE_ASSETS } = await import('@soulidity/sdk')

const ownerKp = decodeEd25519SecretKey(process.env.MAINNET_DEPLOYER_PRIV_KEY!.trim(), 'MAINNET_DEPLOYER_PRIV_KEY')
const buyerKp = decodeEd25519SecretKey(process.env.PHASE2_BUYER_PRIV_KEY!.trim(), 'PHASE2_BUYER_PRIV_KEY')
const buyerAddr = buyerKp.toSuiAddress()

// Soul2 (minted via §12.10 publishWithBind, still owned by publisher).
const SOUL2_STATE = '0x4d0c2233771cb83b46f12a4ec5d71151bef1897eee46e2da3709ecffbf1f6b78'
const SOUL2_CONTENT = '0xf3f9ccb8bb7c7a9383341d153f4d50e00896369750c962f3a21066979c5b56dc'
const SOUL2_PAID_LIST = '0x60c795baa4e83a74312330e8f4dbd79e8bf1de071fb55c09d8ea48d6015fe9d3'
const PUB_KIOSK = '0xe677f1a96d815e6c8ab3e8f39b77b86d829a57b7e6e591c9857c373a20ec8fbf'
const PUB_KIOSK_CAP = '0x161c6ea7207dd73528e4f6b1c5270659e77ac43adde4dfc3fc9c808ac4230500'

// Fresh walrus blobs (just uploaded).
const BLOB_MEM_APPEND = '0xe29d0dd265ea72e9eb5039af0b39ac0f6955624fd1673e0bea2adfffebbb8677'
const BLOB_S3_DOC = '0x907eb7a377dbc7e50d582865af3054fce9aaddf803b344a792a58b47ea1ed72b'
const BLOB_S3_MEMORY = '0xfd80a420fc3e6c85ad6023453a21316a049bbe63a103216546256548e410f3d8'
const BLOB_S3_SKILL = '0xebdd6fce0ab43711873fdbb23ef4ea443d3480853e43b85422e1f52a0b3cc9b8'
const BLOB_S3_SPRITE = '0x303c0222fff427d894b879af10eb024a899d85436e1b23bb6dff0a874490ca65'

// Lower price so buyer's remaining USDC ($0.95 after §12.7+§12.9) can cover.
// price=500_000 + 250bps platform = 512_500 atomic ($0.5125).
const PAID_PRICE_ATOMIC = 500_000n
const PAID_TOTAL_ATOMIC = 512_500n // price * (1 + 250/10000)

const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('mainnet'), network: 'mainnet' })

async function exec(label: string, txFactory: () => Promise<{ tx: Transaction; signer: Ed25519Keypair }>) {
  try {
    const { tx, signer } = await txFactory()
    const res = await client.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: { showEffects: true },
    })
    if (res.effects?.status?.status === 'success') {
      console.log(`✓ ${label} — digest=${res.digest}`)
      return res.digest
    }
    console.log(`✗ ${label} — ${res.effects?.status?.error}`)
    return null
  } catch (e) {
    console.log(`✗ ${label} — ${(e as Error).message}`)
    return null
  }
}

// §12.6.append — append a 2nd memory version to Soul2
await exec('§12.6.append memory v1 to Soul2', async () => ({
  tx: buildAppendContentVersionAsOwnerTx({
    contentObjectId: SOUL2_CONTENT,
    stateObjectId: SOUL2_STATE,
    kindRegistryObjectId: m.kindRegistryId,
    kind: KIND_MEMORY,
    name: CANONICAL_MEMORY_NAME,
    slotReadModeMask: READ_OWNER | READ_GRANT,
    downloadPolicy: 'public',
    contentBlobObjectId: BLOB_MEM_APPEND,
  }),
  signer: ownerKp,
}))

// §12.4.configure (Soul2 sprite, lower price for buyer)
await exec('§12.4.configure paid_access Soul2 sprite price=500_000', async () => ({
  tx: buildConfigurePaidAccessKindTx({
    paidAccessListObjectId: SOUL2_PAID_LIST,
    stateObjectId: SOUL2_STATE,
    kindRegistryObjectId: m.kindRegistryId,
    kind: KIND_SPRITE,
    priceAtomic: PAID_PRICE_ATOMIC,
    scopeMask: SOUL_GRANT_SCOPE_ASSETS,
    durationMs: null,
  }),
  signer: ownerKp,
}))

// §12.4.purchase (buyer signs)
const buyerUsdc = (await client.getCoins({ owner: buyerAddr, coinType: m.paymentCoinType, limit: 1 })).data[0]
if (!buyerUsdc) {
  console.log('✗ §12.4.purchase — buyer has no USDC')
} else {
  await exec('§12.4.purchase paid_access Soul2 sprite (buyer signs)', async () => ({
    tx: buildPurchasePaidAccessTx({
      paidAccessListObjectId: SOUL2_PAID_LIST,
      stateObjectId: SOUL2_STATE,
      kind: KIND_SPRITE,
      paymentCoinObjectIds: [buyerUsdc.coinObjectId],
      totalAtomic: PAID_TOTAL_ATOMIC,
    }),
    signer: buyerKp,
  }))
}

// §12.5a — mint Soul3 with public sprite (READ_OWNER | READ_PUBLIC, download_policy=public)
await exec('§12.5a mint Soul3 with public sprite', async () => ({
  tx: await buildPublishSoulTx({
    currentKioskId: PUB_KIOSK,
    currentKioskCapOnChainId: PUB_KIOSK_CAP,
    name: 'Phase2 Smoke Soul3 (public sprite)',
    description: 'public-sprite variant',
    imageUrl: 'https://example.com/smoke-soul3.png',
    creatorRoyaltyBps: 250,
    initialContent: [
      {
        kind: KIND_SOUL_DOC,
        name: CANONICAL_SOUL_DOC_NAME,
        slotReadModeMask: READ_OWNER | READ_GRANT,
        downloadPolicy: 'public',
        setActive: false,
        blobObjectId: BLOB_S3_DOC,
      },
      {
        kind: KIND_MEMORY,
        name: CANONICAL_MEMORY_NAME,
        slotReadModeMask: READ_OWNER | READ_GRANT,
        downloadPolicy: 'public',
        setActive: false,
        blobObjectId: BLOB_S3_MEMORY,
      },
      {
        kind: KIND_SKILL,
        name: 'default',
        slotReadModeMask: READ_OWNER | READ_GRANT,
        downloadPolicy: 'public',
        setActive: false,
        blobObjectId: BLOB_S3_SKILL,
      },
      {
        kind: KIND_SPRITE,
        name: 'persona-sprite',
        slotReadModeMask: READ_OWNER | READ_PUBLIC, // public sprite path
        downloadPolicy: 'public',
        setActive: true,
        blobObjectId: BLOB_S3_SPRITE,
      },
    ],
    initialStateConfig: [],
  }),
  signer: ownerKp,
}))
