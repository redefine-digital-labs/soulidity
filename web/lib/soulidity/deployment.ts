import deploymentManifestJson from './deployment-manifest.json'

export interface SoulidityDeployment {
  packageId: string
  marketConfigId: string
  kioskRegistryId: string
  soulTransferPolicyId: string
  collectionTransferPolicyId: string
  paymentCoinType: string
  publishTxDigest?: string
  upgradeCapId?: string
}

export type SoulidityDeploymentManifest = Record<string, SoulidityDeployment>

const deploymentManifest = deploymentManifestJson as SoulidityDeploymentManifest

export class MissingSoulidityDeploymentError extends Error {
  constructor(readonly network: string) {
    super(`Missing Soulidity deployment manifest entry for network: ${network}`)
    this.name = 'MissingSoulidityDeploymentError'
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
