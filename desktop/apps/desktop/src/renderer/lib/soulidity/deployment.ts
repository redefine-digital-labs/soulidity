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
  // Mainnet first publish: 2026-04-26. Desktop intentionally inlines the
  // manifest instead of reading the JSON file. Keep in sync with
  // web/lib/soulidity/deployment-manifest.json.mainnet.
  mainnet: {
    packageId: '0x994eeb7f0a9b4519feb2a1346ca4786e4bf8435b706a7fc2b1a4eb2fbbc9db2f',
    marketConfigId: '0xa0a09fa8b905cfb9ca3b53bc88dd167f4d6f9b4bffaf7b542099bbd4021e6ce5',
    kioskRegistryId: '0x30dabdeb7e432dc4683c6819a6d1b748350c2909045b82336c300cc5df2fd906',
    soulTransferPolicyId: '0x90d61e4786eb5ff6002cd666d706e55c57ff6a000c3eac32de4be5909af799fb',
    collectionTransferPolicyId: '0xb45dfdf630d6f4f694622154cf4f3b57d0977ffeb49eb38e406fb6a7a0a07039',
    paymentCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    publishTxDigest: 'CnH9DvyWeEeUq6TiEEj45Qw2ytWjQiRSPU6kbebyrJSu',
    upgradeCapId: '0x2044e2404ef11f00044e71ec1237734f11da2ad432a2930b8dd63ce26332d65a',
    upgradeStateId: '0xbe31ce205de53e2e9acdf59a2b7c455a6e5bc9ca7e0df6dc245b46b7b24ed6ce',
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
