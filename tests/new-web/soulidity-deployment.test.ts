import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import deploymentManifest from '@soulidity/sdk/deployment-manifest.json'
import {
  MissingSoulidityDeploymentError,
  getConfiguredSoulidityNetwork,
  getSoulidityAnimacraftProvenancePackageId,
  getSoulidityCallablePackageId,
  getSoulidityDeployment,
  getSoulidityMarketConfigV2PackageId,
  getSoulidityOriginalPackageId,
} from '@soulidity/sdk'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'

const ORIGINAL_NETWORK = process.env.NEXT_PUBLIC_SUI_NETWORK
const ORIGINAL_PACKAGE_ID = process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID
const ORIGINAL_CALLABLE_PACKAGE_ID = process.env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID
const ORIGINAL_ORIGINAL_PACKAGE_ID = process.env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID
const ORIGINAL_PROVENANCE_PACKAGE_ID =
  process.env.NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID
const ORIGINAL_MARKET_CONFIG_V2_ID =
  process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID
const ORIGINAL_MARKET_CONFIG_V2_PACKAGE_ID =
  process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID

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
    restoreEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', ORIGINAL_CALLABLE_PACKAGE_ID)
    restoreEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID', ORIGINAL_ORIGINAL_PACKAGE_ID)
    restoreEnv(
      'NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID',
      ORIGINAL_PROVENANCE_PACKAGE_ID,
    )
    restoreEnv(
      'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID',
      ORIGINAL_MARKET_CONFIG_V2_ID,
    )
    restoreEnv(
      'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID',
      ORIGINAL_MARKET_CONFIG_V2_PACKAGE_ID,
    )
  })

  it('resolves the active network deployment from the manifest', () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'testnet'

    expect(getConfiguredSoulidityNetwork()).toBe('testnet')
    expect(getSoulidityDeployment()).toEqual(deploymentManifest.testnet)
    expect(getSoulidityCallablePackageId()).toBe(deploymentManifest.testnet.callablePackageId)
    expect(getSoulidityOriginalPackageId()).toBe(deploymentManifest.testnet.originalPackageId)
    expect(getSoulidityAnimacraftProvenancePackageId()).toBe(
      deploymentManifest.testnet.animacraftProvenancePackageId,
    )
    expect(getSoulidityMarketConfigV2PackageId()).toBe(
      deploymentManifest.testnet.marketConfigV2PackageId
        || deploymentManifest.testnet.callablePackageId,
    )
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
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')).toBe(
      deploymentManifest.mainnet.callablePackageId,
    )
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')).toBe(
      deploymentManifest.mainnet.originalPackageId,
    )
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID')).toBe(
      deploymentManifest.mainnet.marketConfigV2PackageId
        || deploymentManifest.mainnet.callablePackageId,
    )
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')).toBe(deploymentManifest.mainnet.packageId)
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')).toBe(deploymentManifest.mainnet.marketConfigV2Id)
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID')).toBe(deploymentManifest.mainnet.soulTransferPolicyId)
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID')).toBe(deploymentManifest.mainnet.collectionTransferPolicyId)
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE')).toBe(
      '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    )
  })

  it('keeps the existing published record historical without V6 runtime config', () => {
    const publishedToml = readFileSync(
      new URL('../../move/soulidity/Published.toml', import.meta.url),
      'utf8',
    )
    const mainnetSection = publishedToml.match(
      /\[published\.mainnet\]([\s\S]*?)(?=\n\[published\.|$)/,
    )?.[1]

    expect(mainnetSection).toBeDefined()
    for (const entry of Object.values(deploymentManifest)) {
      expect(Object.keys(entry).filter(key => /V6/.test(key))).toEqual([])
    }
    expect(mainnetSection).toContain(
      'published-at = "0x60bf39455f90e2af94381f2434d2c013c4e38a12fd16873ac296a26660f92ecd"',
    )
    expect(mainnetSection).toContain(
      'original-id = "0xa43cc9a94caa904a97316d97c08804369ee8fbe3335d2ddae154022d7d6e5d5d"',
    )
    expect(mainnetSection).toMatch(/\nversion = 2\n/)
    expect(deploymentManifest.mainnet).toMatchObject({
      callablePackageId: '0x5e3e75de3e1f661ffcad9bd0d53f3ea97e2e48f0765d2b2d9532256806409bb9',
      originalPackageId: '0x5e3e75de3e1f661ffcad9bd0d53f3ea97e2e48f0765d2b2d9532256806409bb9',
      marketConfigV2Id: '0x2171d5268a6af1ca7efbc53eaa5bc4a80ab94733f0fadd8da4486bc9bec50f3c',
      marketAdminCapV2Id: '0xb9000621d325ee895f7cc9e840fac3f849b02961a5538083f6bcb13629c9d90e',
      publishTxDigest: 'HwE7FJzTEzB1QHucWXBnAjCdBHTQ6kNz6smqiqULM6SN',
    })
    for (const retired of ['marketConfigId', 'animacraftProvenancePackageId', 'upgradeTxDigest', 'legacyMarketRetirementTxDigest']) {
      expect(deploymentManifest.mainnet).not.toHaveProperty(retired)
    }
  })

  it('honors explicit env overrides before falling back to the manifest', () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'mainnet'
    process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID = '0x111'

    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')).toBe('0x111')
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')).toBe(deploymentManifest.mainnet.marketConfigV2Id)
  })

  it('uses the V2 config id and honors explicit overrides', () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'mainnet'
    delete process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID

    expect(getRequiredSoulidityEnv(
      'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID',
    )).toBe(deploymentManifest.mainnet.marketConfigV2Id)

    process.env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID = '0x900d'
    expect(getRequiredSoulidityEnv(
      'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID',
    )).toBe('0x900d')
  })

  it('keeps callable, original, and upgraded-type defining packages independent', () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'mainnet'
    process.env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID = '0xcafe'
    process.env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID = '0xfeed'
    process.env.NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID = '0xbeef'

    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')).toBe('0xcafe')
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')).toBe('0xfeed')
    expect(
      getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID'),
    ).toBe('0xbeef')
    // The legacy key is intentionally an original-package compatibility alias.
    delete process.env.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID
    expect(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')).toBe('0xfeed')
  })

  it('throws a targeted error for unsupported networks', () => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'devnet'

    expect(() => getSoulidityDeployment()).toThrow(MissingSoulidityDeploymentError)
    expect(() => getSoulidityDeployment()).toThrow('Missing Soulidity deployment manifest entry for network: devnet')
  })
})
