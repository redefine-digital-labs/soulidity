import deploymentManifestJson from './deployment-manifest.json'

export interface SoulidityDeployment {
  /**
   * Latest package version whose entry functions can be called.
   *
   * `packageId` remains as a deprecated manifest alias so older generated
   * manifests can still be read outside production.
   */
  callablePackageId?: string
  /**
   * Original package id that defines all types and events which existed in the
   * initial publish.
   */
  originalPackageId?: string
  /**
   * Defining package for AnimacraftProvenance, which was introduced by an
   * upgrade and therefore is neither the protocol's original package nor
   * necessarily the latest callable package after future upgrades.
   */
  animacraftProvenancePackageId?: string
  /**
   * Defining package for `market::MarketConfigV2` and
   * `market::MarketAdminCapV2`. It is the callable package that introduced
   * those types and remains stable across later upgrades.
   */
  marketConfigV2PackageId?: string
  /** @deprecated Use `callablePackageId` or `originalPackageId` explicitly. */
  packageId: string
  marketConfigId: string
  /**
   * Unified successor config created by `market::retire_legacy_market`.
   *
   * It is deliberately absent until the irreversible retirement transaction
   * succeeds. All market transaction builders fail closed when it is missing.
   */
  marketConfigV2Id?: string
  /** Admin cap created by the same irreversible market-retirement transaction. */
  marketAdminCapV2Id?: string
  kioskRegistryId: string
  kindRegistryId?: string
  soulTransferPolicyId: string
  collectionTransferPolicyId: string
  paymentCoinType: string
  publishTxDigest?: string
  upgradeCapId?: string
  kindAdminCapId?: string
}

export type SoulidityDeploymentManifest = Record<string, SoulidityDeployment>

const deploymentManifest = deploymentManifestJson as SoulidityDeploymentManifest

export class MissingSoulidityDeploymentError extends Error {
  constructor(readonly network: string) {
    super(`Missing Soulidity deployment manifest entry for network: ${network}`)
    this.name = 'MissingSoulidityDeploymentError'
  }
}

export class InvalidSoulidityPackageRoutingError extends Error {
  constructor(readonly network: string, message: string) {
    super(`Invalid Soulidity package routing for ${network}: ${message}`)
    this.name = 'InvalidSoulidityPackageRoutingError'
  }
}

function normalizeNetwork(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase()
  return normalized && normalized.length > 0 ? normalized : 'testnet'
}

export function getConfiguredSoulidityNetwork() {
  return normalizeNetwork(process.env.NEXT_PUBLIC_SUI_NETWORK)
}

export function getSoulidityDeploymentManifest() {
  return deploymentManifest
}

export function getSoulidityDeployment(network = getConfiguredSoulidityNetwork()): SoulidityDeployment {
  const deployment = deploymentManifest[network]
  if (!deployment) {
    throw new MissingSoulidityDeploymentError(network)
  }

  return deployment
}

function requirePackageId(value: string | null | undefined, network: string, label: string): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new InvalidSoulidityPackageRoutingError(network, `${label} is missing`)
  }
  return normalized
}

/**
 * Resolve the latest package version used in every Move transaction target.
 *
 * Legacy manifests fall back to `packageId` in development/test. Production
 * manifests must name the routing explicitly so an in-place upgrade cannot
 * silently keep calling the original package.
 */
export function getSoulidityCallablePackageId(network = getConfiguredSoulidityNetwork()): string {
  const deployment = getSoulidityDeployment(network)
  if (process.env.NODE_ENV === 'production' && !deployment.callablePackageId) {
    throw new InvalidSoulidityPackageRoutingError(network, 'callablePackageId is required in production')
  }
  return requirePackageId(deployment.callablePackageId ?? deployment.packageId, network, 'callablePackageId')
}

/**
 * Resolve the original package that defines pre-upgrade object and event
 * identities. This id must never be substituted into a transaction target.
 */
export function getSoulidityOriginalPackageId(network = getConfiguredSoulidityNetwork()): string {
  const deployment = getSoulidityDeployment(network)
  if (process.env.NODE_ENV === 'production' && !deployment.originalPackageId) {
    throw new InvalidSoulidityPackageRoutingError(network, 'originalPackageId is required in production')
  }
  return requirePackageId(deployment.originalPackageId ?? deployment.packageId, network, 'originalPackageId')
}

export function getSoulidityAnimacraftProvenancePackageId(
  network = getConfiguredSoulidityNetwork(),
): string {
  const deployment = getSoulidityDeployment(network)
  if (process.env.NODE_ENV === 'production' && !deployment.animacraftProvenancePackageId) {
    throw new InvalidSoulidityPackageRoutingError(
      network,
      'animacraftProvenancePackageId is required in production',
    )
  }
  return requirePackageId(
    deployment.animacraftProvenancePackageId
      ?? deployment.callablePackageId
      ?? deployment.packageId,
    network,
    'animacraftProvenancePackageId',
  )
}

export function getSoulidityMarketConfigV2PackageId(
  network = getConfiguredSoulidityNetwork(),
): string {
  const deployment = getSoulidityDeployment(network)
  if (process.env.NODE_ENV === 'production' && !deployment.marketConfigV2PackageId) {
    throw new InvalidSoulidityPackageRoutingError(
      network,
      'marketConfigV2PackageId is required in production',
    )
  }
  return requirePackageId(
    deployment.marketConfigV2PackageId?.trim()
      || deployment.callablePackageId
      || deployment.packageId,
    network,
    'marketConfigV2PackageId',
  )
}
