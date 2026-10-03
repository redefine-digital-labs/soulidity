import { assertWalletProfileDeployment, type PublicProfileStorageTarget, type WalletProfileDeployment } from '@soulidity/sdk'

export interface BrowserProfileConfig {
  deployment: WalletProfileDeployment
  storage: PublicProfileStorageTarget
  writesEnabled: boolean
}
/** Public build configuration from the same new release, with no old registry
 * or testnet fallback when that release has not yet been configured. */
export function getBrowserProfileReadConfig(): Omit<BrowserProfileConfig, 'writesEnabled'> {
  const deployment = assertWalletProfileDeployment({
    originalPackageId: process.env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID ?? '',
    callablePackageId: process.env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID ?? '',
    registryId: process.env.NEXT_PUBLIC_SOULIDITY_PROFILE_REGISTRY_ID ?? '',
    chainIdentifier: process.env.NEXT_PUBLIC_SUI_CHAIN_IDENTIFIER ?? '',
  })
  const blobType = process.env.NEXT_PUBLIC_WALRUS_BLOB_TYPE ?? ''
  const aggregatorUrl = process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL ?? ''
  if (!/^0x[0-9a-f]{64}::blob::Blob$/.test(blobType) || blobType.startsWith(`0x${'0'.repeat(64)}::`)) throw new Error('PROFILE_STORAGE_TYPE_INVALID')
  const url = new URL(aggregatorUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('PROFILE_STORAGE_URL_INVALID')
  return { deployment, storage: { blobType, aggregatorUrl } }
}
export function getBrowserProfileConfig(): BrowserProfileConfig {
  const config = getBrowserProfileReadConfig()
  const writes = process.env.NEXT_PUBLIC_SOULIDITY_PROFILE_WRITES_ENABLED
  if (writes !== 'true' && writes !== 'false') throw new Error('PROFILE_WRITE_CONFIGURATION_REQUIRED')
  return { ...config, writesEnabled: writes === 'true' }
}
