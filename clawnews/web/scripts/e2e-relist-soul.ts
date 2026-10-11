/**
 * E2E Test: Relist a held Soul as a fixed-price listing.
 *
 * Phase 7.10g step 1 of `docs/plans/e2e-test-plan.md`: after Test 7.3 transfers
 * Soul B from Seller to Agent Alpha, the new owner must relist it so that the
 * paid-access epoch-pinning verification (steps 2-6) has a real on-chain resale
 * to assert against.
 *
 * Wraps `buildListSoulTx` from `@soulidity/sdk` (the canonical PTB:
 * `ensure_personal_kiosk_registered` → `list_soul_fixed_price` →
 * `finalize_soul_listing`). Mainnet ABI no longer takes a `soul_id` argument;
 * never hand-roll the moveCall.
 *
 * Reads env (NEXT_PUBLIC_SOULIDITY_* aliases accepted so a `.env.local` works):
 *   PACKAGE_ID                 — Soulidity package ID
 *   MARKET_CONFIG_ID           — MarketConfig shared object
 *   KIOSK_REGISTRY_OBJ         — KioskRegistry shared object
 *   SOUL_STATE_OBJECT_ID       — The SoulState shared object
 *   SOUL_KIOSK_ID              — Personal kiosk holding the Soul (current owner)
 *   SOUL_KIOSK_CAP_ID          — PersonalKioskCap held by the current owner
 *   PRICE_ATOMIC               — Listing price in atomic USDC (must be > 0)
 *   COLLECTION_OBJECT_ID       — (optional) bind into collection on list
 *   OWNER_PRIVATE_KEY          — Bech32 / base64 / hex Ed25519 private key
 *   SUI_NETWORK                — mainnet | testnet (default: mainnet)
 *
 * Usage:
 *   OWNER_PRIVATE_KEY="$E2E_AGENT_ALPHA_PRIVATE_KEY" \
 *   PACKAGE_ID="$PACKAGE_ID" MARKET_CONFIG_ID="$MARKET_CONFIG_ID" \
 *   KIOSK_REGISTRY_OBJ="$KIOSK_REGISTRY_OBJ" \
 *   SOUL_STATE_OBJECT_ID="$SOUL_B_STATE_OBJ" \
 *   SOUL_KIOSK_ID="$SOUL_B_AGENT_KIOSK_ID" \
 *   SOUL_KIOSK_CAP_ID="$SOUL_B_AGENT_KIOSK_CAP_ID" \
 *   PRICE_ATOMIC=100000 \
 *   npx tsx web/scripts/e2e-relist-soul.ts
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { buildListSoulTx, extractSoulListedEvent } from '@soulidity/sdk'
import { loadKeypairFromEnv } from '../../scripts/lib/keypair'
import { prisma } from '../lib/prisma'
import { syncSoulProjectionFromChain } from '../lib/soulidity/mirror/sync-helpers'
import { storeSoulidityTxSync } from '../lib/soulidity/mirror/tx-sync'

function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}

function requireEnv(name: string, ...aliases: string[]): string {
  const value = readEnv(name, ...aliases)
  if (!value) {
    const all = [name, ...aliases].join(' / ')
    throw new Error(`Missing required env: ${all}`)
  }
  return value
}

async function main() {
  // SDK's buildListSoulTx pulls package / market-config / kiosk-registry IDs
  // from NEXT_PUBLIC_SOULIDITY_* env, so bridge whichever name the caller used.
  const packageId = requireEnv('PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const marketConfigId = requireEnv('MARKET_CONFIG_ID', 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const kioskRegistryId = requireEnv('KIOSK_REGISTRY_OBJ', 'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID = packageId
  process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID = marketConfigId
  process.env.NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID = kioskRegistryId

  const stateObjectId = requireEnv('SOUL_STATE_OBJECT_ID')
  const currentKioskId = requireEnv('SOUL_KIOSK_ID')
  const currentKioskCapOnChainId = requireEnv('SOUL_KIOSK_CAP_ID')
  const priceRaw = requireEnv('PRICE_ATOMIC')
  const collectionObjectId = readEnv('COLLECTION_OBJECT_ID') ?? null
  const network = (readEnv('SUI_NETWORK', 'NEXT_PUBLIC_SUI_NETWORK') ?? 'mainnet') as
    | 'mainnet'
    | 'testnet'
    | 'devnet'

  let priceAtomic: bigint
  try {
    priceAtomic = BigInt(priceRaw)
  } catch {
    throw new Error(`PRICE_ATOMIC must be an integer (atomic USDC), got: ${priceRaw}`)
  }
  if (priceAtomic <= 0n) {
    throw new Error('PRICE_ATOMIC must be > 0 (free access uses paid_access::add_access)')
  }

  const keypair = loadKeypairFromEnv('OWNER_PRIVATE_KEY')
  const sender = keypair.toSuiAddress()

  console.log(`Sender (owner): ${sender}`)
  console.log(`Network:        ${network}`)
  console.log(`Soul state:     ${stateObjectId}`)
  console.log(`Kiosk:          ${currentKioskId}`)
  console.log(`Kiosk cap:      ${currentKioskCapOnChainId}`)
  console.log(`Price (atomic): ${priceAtomic.toString()}`)
  if (collectionObjectId) console.log(`Collection:     ${collectionObjectId}`)

  const tx = buildListSoulTx({
    currentKioskId,
    currentKioskCapOnChainId,
    stateObjectId,
    priceAtomic,
    collectionObjectId,
  })
  tx.setSender(sender)

  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network })
  const bytes = await tx.build({ client })
  const { signature } = await keypair.signTransaction(bytes)

  const result = await client.executeTransactionBlock({
    transactionBlock: Buffer.from(bytes).toString('base64'),
    signature,
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
  })
  await client.waitForTransaction({ digest: result.digest }).catch(() => undefined)

  console.log(`\nTX digest: ${result.digest}`)
  console.log(`Status:    ${JSON.stringify(result.effects?.status)}`)

  const listedEvent = result.events?.find((e) => /::market::SoulListed$/.test(e.type))
  if (!listedEvent) {
    console.error('SoulListed event not emitted — relist failed.')
    process.exit(1)
  }
  console.log(`SoulListed event:\n${JSON.stringify(listedEvent.parsedJson, null, 2)}`)

  const listed = extractSoulListedEvent(result, packageId)
  const existing = await prisma.soulAsset.findUnique({
    where: { onChainId: listed.soulId },
    select: {
      creatorMemberId: true,
      currentOwnerMemberId: true,
      tags: true,
      previewImages: true,
      readme: true,
      activeSpriteName: true,
      activeSpriteVersionIndex: true,
      activeSpriteDownloadPolicy: true,
      activeVoiceName: true,
      activeVoiceVersionIndex: true,
      activeVoiceDownloadPolicy: true,
    },
  })
  if (!existing) {
    throw new Error(`Cannot mirror relist: Soul ${listed.soulId} is missing from DB`)
  }

  const mirrored = await syncSoulProjectionFromChain({
    packageId,
    soulObjectId: listed.soulId,
    stateObjectId,
    currentKioskCapOnChainId,
    creatorMemberId: existing.creatorMemberId,
    currentOwnerMemberId: existing.currentOwnerMemberId,
    tags: existing.tags,
    previewImages: existing.previewImages,
    readme: existing.readme,
    listingObjectOnChainId: listed.listingId,
    listedPriceAtomic: listed.priceAtomic,
    listingStatus: 'listed',
    activeSprite: existing.activeSpriteName && existing.activeSpriteVersionIndex != null && existing.activeSpriteDownloadPolicy
      ? {
          name: existing.activeSpriteName,
          versionIndex: existing.activeSpriteVersionIndex,
          downloadPolicy: existing.activeSpriteDownloadPolicy,
        }
      : null,
    activeVoice: existing.activeVoiceName && existing.activeVoiceVersionIndex != null && existing.activeVoiceDownloadPolicy
      ? {
          name: existing.activeVoiceName,
          versionIndex: existing.activeVoiceVersionIndex,
          downloadPolicy: existing.activeVoiceDownloadPolicy,
        }
      : null,
  })

  const responseBody = {
    txDigest: result.digest,
    soulOnChainId: mirrored.onChainId,
    listingObjectOnChainId: mirrored.listingObjectOnChainId,
    listedPriceAtomic: mirrored.listedPriceAtomic?.toString() ?? null,
    listingStatus: mirrored.listingStatus,
  }
  await storeSoulidityTxSync({
    routeKey: 'list',
    txDigest: result.digest,
    actorKey: existing.currentOwnerMemberId ?? sender,
    resourceKey: mirrored.onChainId,
    statusCode: 200,
    responseBody,
  })
  console.log(`Mirrored listing:\n${JSON.stringify(responseBody, null, 2)}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
