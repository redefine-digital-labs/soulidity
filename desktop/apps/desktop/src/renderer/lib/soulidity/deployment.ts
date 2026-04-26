export interface SoulidityDeployment {
  packageId: string
  marketConfigId: string
  kioskRegistryId: string
  soulTransferPolicyId: string
  collectionTransferPolicyId: string
  paymentCoinType: string
  publishTxDigest?: string
  upgradeCapId?: string
  upgradeStateId?: string
}

const deploymentManifest: Record<string, SoulidityDeployment> = {
  testnet: {
    packageId: '0x65898551bc1ccd3cfb52a9dcf77632464d1e82460325167aa510ce5f40d2cd16',
    marketConfigId: '0xf07b3cba75643bc08c845f7f96366f5e3df62ac739dba6b142aafde11d5da3d4',
    kioskRegistryId: '0x51c3c0b58052cfc55bd531a85ed550669218d67b3fe0a7e498be518972d122e7',
    soulTransferPolicyId: '0xee83be15d29ea889a8ab8e58c62c49fa48cfa809e943f6e172fab8ad664f5689',
    collectionTransferPolicyId: '0x2eeaa66ecc151014401cddb6c71caf88ea773e55a32e4f43172bfd3018415246',
    paymentCoinType: '0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325::usdc::USDC',
    publishTxDigest: 'AoYgjLGdDbwAi3y46AnbiqpZ1xj6woTWdWvszKmxc1ET',
    upgradeCapId: '0x7fd33aedd3f2679c681f8c4d9a3e61aa464fb01c31a5719ed2c626e34538883b',
  },
  // Seeded for release/mainnet-v1; populate after first mainnet publish from
  // web/lib/soulidity/deployment-manifest.json. Desktop intentionally inlines
  // the manifest instead of reading the JSON file.
  mainnet: {
    packageId: '',
    marketConfigId: '',
    kioskRegistryId: '',
    soulTransferPolicyId: '',
    collectionTransferPolicyId: '',
    paymentCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  },
}

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

export function getSoulidityDeployment(network = getConfiguredSoulidityNetwork()): SoulidityDeployment {
  const deployment = deploymentManifest[network]
  if (!deployment) {
    throw new MissingSoulidityDeploymentError(network)
  }

  return deployment
}
