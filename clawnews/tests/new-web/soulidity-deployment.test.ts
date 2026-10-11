import { afterEach, describe, expect, it } from 'vitest'

import deploymentManifest from '@soulidity/sdk/deployment-manifest.json'
import {
  MissingSoulidityDeploymentError,
  getConfiguredSoulidityNetwork,
  getSoulidityDeployment,
} from '@soulidity/sdk'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'

const ORIGINAL_NETWORK = process.env.NEXT_PUBLIC_SUI_NETWORK
const ORIGINAL_PACKAGE_ID = process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

describe('Soulidity deployment manifest', () => {
  afterEach(() => {
    restoreEnv('NEXT_PUBLIC_SUI_NETWORK', ORIGINAL_NETWORK)
    restoreEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID', ORIGINAL_PACKAGE_ID)
  })

  it('resolves the active network deployment from the manifest', () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'testnet'

    expect(getConfiguredSoulidityNetwork()).toBe('testnet')
    expect(getSoulidityDeployment()).toEqual(deploymentManifest.testnet)
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')).toBe(deploymentManifest.testnet.packageId)
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')).toBe(deploymentManifest.testnet.marketConfigId)
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID')).toBe(deploymentManifest.testnet.soulTransferPolicyId)
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID')).toBe(deploymentManifest.testnet.collectionTransferPolicyId)
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE')).toBe(deploymentManifest.testnet.paymentCoinType)
  })

  it('resolves the mainnet deployment from the manifest', () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'mainnet'

    expect(getConfiguredSoulidityNetwork()).toBe('mainnet')
    expect(getSoulidityDeployment()).toEqual(deploymentManifest.mainnet)
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')).toBe(deploymentManifest.mainnet.packageId)
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')).toBe(deploymentManifest.mainnet.marketConfigId)
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID')).toBe(deploymentManifest.mainnet.soulTransferPolicyId)
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID')).toBe(deploymentManifest.mainnet.collectionTransferPolicyId)
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE')).toBe(
      '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    )
  })

  it('honors explicit env overrides before falling back to the manifest', () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'mainnet'
    process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID = '0x111'

    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')).toBe('0x111')
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')).toBe(deploymentManifest.mainnet.marketConfigId)
  })

  it('throws a targeted error for unsupported networks', () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'devnet'

    expect(() => getSoulidityDeployment()).toThrow(MissingSoulidityDeploymentError)
    expect(() => getSoulidityDeployment()).toThrow('Missing Soulidity deployment manifest entry for network: devnet')
  })
})
