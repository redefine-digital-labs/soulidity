import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, toHex } from '@mysten/sui/utils'
import {
  getPersonalKioskCapTypePackageAddress, profileReadStep, readSoulPublicSnapshotBySoulId,
  readSoulDetailState, readSoulPublicListing, SOUL_PUBLIC_USDC_TYPE,
} from '@soulidity/sdk'
import { getBrowserNativeReceiveTarget } from '@/lib/animacraft/browser-native-config'
import { createNativeReceiveClient, receiveId, type NativeReceiveTarget } from '@/lib/animacraft/native-receive'
import { MAINNET_GENESIS_DIGEST } from '@/lib/animacraft/mainnet-chain'
import { readBrowserSoulCustody, type BrowserSoulListingScan } from './browser-soul-custody'
import { resolveBrowserNativeListingDeployment } from './browser-native-listing-authority'
import { composeChainSoulDetail } from './soul-detail-model'

export interface BrowserSoulDetailConfig {
  native: NativeReceiveTarget
  chainIdentifier: string; marketConfigId: string; kindRegistryId: string; kioskRegistryId: string
  personalKioskTypePackageId: string; paymentCoinType: string; discoveryEndpoint: string | null
}

/** Exact public fields of the one release. No checked-in deployment manifest,
 * server env, SQL, local receipt, or old package is a fallback for a deep link. */
export function getBrowserSoulDetailConfig(): BrowserSoulDetailConfig {
  const config = {
    native: getBrowserNativeReceiveTarget(),
    chainIdentifier: toHex(fromBase58(MAINNET_GENESIS_DIGEST).subarray(0, 4)),
    marketConfigId: receiveId(process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID),
    kindRegistryId: receiveId(process.env.NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID),
    kioskRegistryId: receiveId(process.env.NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID),
    personalKioskTypePackageId: getPersonalKioskCapTypePackageAddress(),
    paymentCoinType: process.env.NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE ?? '',
    discoveryEndpoint: process.env.NEXT_PUBLIC_SUI_GRAPHQL_URL ?? null,
  }
  if (config.paymentCoinType !== SOUL_PUBLIC_USDC_TYPE) throw new Error('SOUL_DETAIL_PAYMENT_TYPE_INVALID')
  return config
}

type Dependencies = {
  client?: (signal: AbortSignal) => SuiGrpcClient
  asset?: typeof readSoulPublicSnapshotBySoulId
  state?: typeof readSoulDetailState
  custody?: typeof readBrowserSoulCustody
  nativeListing?: typeof resolveBrowserNativeListingDeployment
  listing?: typeof readSoulPublicListing
}

/** Direct browser read composition. Each component verifies canonical raw BCS
 * and its own stable readset. The final exact public-state reread detects a
 * transfer/change between components. This is not an atomic global checkpoint.
 * All failures remain failures, never empty content or an unlisted-price guess. */
export async function readBrowserSoulDetail(params: {
  soulId: string; viewerAddress: string | null; config: BrowserSoulDetailConfig
  signal?: AbortSignal; getViewerAddress?: () => string | null
  /** Shared, fully verified discovery token from the current Market scan.
   * Retain its identity: the custody reader validates its issuing scan. */
  listingScan?: BrowserSoulListingScan
}, dependencies: Dependencies = {}) {
  const soulId = receiveId(params.soulId), viewerAddress = params.viewerAddress === null ? null : receiveId(params.viewerAddress)
  const config = structuredClone(params.config), listingScan = params.listingScan
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000)
  const assertScope = () => {
    signal.throwIfAborted()
    if (params.getViewerAddress && params.getViewerAddress() !== viewerAddress) throw new Error('SOUL_DETAIL_VIEWER_CHANGED')
  }
  assertScope()
  const client = (dependencies.client ?? createNativeReceiveClient)(signal)
  const deployment = { originalPackageId: config.native.soulidityOriginalPackageId, chainIdentifier: config.chainIdentifier }
  const assetReader = dependencies.asset ?? readSoulPublicSnapshotBySoulId
  const asset = await profileReadStep(signal, () => assetReader({ client, deployment, soulId, signal }))
  assertScope()
  const expectedState = { version: asset.stateVersion, digest: asset.stateDigest }
  const [state, custody, native] = await Promise.all([
    profileReadStep(signal, () => (dependencies.state ?? readSoulDetailState)({ client,
      deployment: { ...deployment, kindRegistryId: config.kindRegistryId }, stateId: asset.stateId, expectedState,
      viewerAddresses: viewerAddress === null ? [] : [viewerAddress], signal })),
    profileReadStep(signal, () => (dependencies.custody ?? readBrowserSoulCustody)({ client,
      deployment: { ...deployment, kioskRegistryId: config.kioskRegistryId, personalKioskTypePackageId: config.personalKioskTypePackageId },
      snapshot: asset, viewer: viewerAddress,
      ...(listingScan ? { listingScan } : {}),
      ...(config.discoveryEndpoint === null ? {} : { discovery: { endpoint: config.discoveryEndpoint, pageSize: 50, maxPages: 40, maxObjects: 2000 } }), signal })),
    profileReadStep(signal, () => (dependencies.nativeListing ?? resolveBrowserNativeListingDeployment)({ client,
      target: config.native, snapshot: asset, signal })),
  ])
  assertScope()
  if (custody.stateVersion !== asset.stateVersion || custody.stateDigest !== asset.stateDigest) throw new Error('SOUL_DETAIL_CUSTODY_CHANGED')
  const listing = await profileReadStep(signal, () => (dependencies.listing ?? readSoulPublicListing)({ client,
    deployment: { ...deployment, marketConfigId: config.marketConfigId, paymentCoinType: config.paymentCoinType, ...(native ? { native } : {}) },
    stateId: asset.stateId, listingId: custody.listingId, expectedState, signal }))
  const finalAsset = await profileReadStep(signal, () => assetReader({ client, deployment, soulId, signal }))
  assertScope()
  if (JSON.stringify(finalAsset) !== JSON.stringify(asset)) throw new Error('SOUL_DETAIL_CHANGED_RETRY')
  return composeChainSoulDetail({ originalPackageId: deployment.originalPackageId, asset, state, listing,
    currentKioskCapId: custody.personalKioskCapId, viewerAddress })
}
