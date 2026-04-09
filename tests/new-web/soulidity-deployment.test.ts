import { afterEach, describe, expect, it } from 'vitest'

import deploymentManifest from '../../web/lib/soulidity/deployment-manifest.json'
import {
  MissingSoulidityDeploymentError,
  getConfiguredSoulidityNetwork,
  getSoulidityDeployment,
} from '@/lib/soulidity/deployment'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'

const ORIGINAL_NETWORK = process.env.NEXT_PUBLIC_SUI_NETWORK

describe('Soulidity deployment manifest', () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = ORIGINAL_NETWORK
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

  it('throws a targeted error for unsupported networks', () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'devnet'

    expect(() => getSoulidityDeployment()).toThrow(MissingSoulidityDeploymentError)
    expect(() => getSoulidityDeployment()).toThrow('Missing Soulidity deployment manifest entry for network: devnet')
  })
})
