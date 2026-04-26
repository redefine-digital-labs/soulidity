import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildCapTransferPtb,
  extractDeploymentFromPublishResult,
  parseArgs,
  readPublishedTomlSections,
  writePublishedTomlSection,
} from '../../scripts/publish-soulidity-and-sync'

// ── extractDeploymentFromPublishResult ─────────────────────

describe('extractDeploymentFromPublishResult', () => {
  it('extracts the core deployment ids from a publish result', () => {
    const deployment = extractDeploymentFromPublishResult({
      digest: '6XqMK1KoLFXTP4gg4rVraN4vqzTJ28kQp7iPR7wkhdLd',
      objectChanges: [
        { type: 'published', packageId: '0xpackage' },
        { objectType: '0x2::package::UpgradeCap', objectId: '0xupgradecap' },
      ],
      events: [
        {
          type: '0xpackage::market::MarketInitialized',
          parsedJson: {
            config_id: '0xconfig',
            registry_id: '0xregistry',
            soul_policy_id: '0xsoulpolicy',
            collection_policy_id: '0xcollectionpolicy',
          },
        },
        {
          type: '0xpackage::market::MarketUpgradeStateInitialized',
          parsedJson: {
            upgrade_state_id: '0xupgradestate',
          },
        },
      ],
    }, {
      paymentCoinType: '0x2::coin::COIN',
    })

    expect(deployment).toEqual({
      packageId: '0xpackage',
      marketConfigId: '0xconfig',
      kioskRegistryId: '0xregistry',
      soulTransferPolicyId: '0xsoulpolicy',
      collectionTransferPolicyId: '0xcollectionpolicy',
      paymentCoinType: '0x2::coin::COIN',
      publishTxDigest: '6XqMK1KoLFXTP4gg4rVraN4vqzTJ28kQp7iPR7wkhdLd',
      upgradeCapId: '0xupgradecap',
      upgradeStateId: '0xupgradestate',
    })
  })

  it('fails fast when payment coin type cannot be resolved', () => {
    expect(() => extractDeploymentFromPublishResult({
      digest: '0xdigest',
      objectChanges: [
        { type: 'published', packageId: '0xpackage' },
        { objectType: '0x2::package::UpgradeCap', objectId: '0xupgradecap' },
      ],
      events: [
        {
          type: '0xpackage::market::MarketInitialized',
          parsedJson: {
            config_id: '0xconfig',
            registry_id: '0xregistry',
            soul_policy_id: '0xsoulpolicy',
            collection_policy_id: '0xcollectionpolicy',
          },
        },
        {
          type: '0xpackage::market::MarketUpgradeStateInitialized',
          parsedJson: {
            upgrade_state_id: '0xupgradestate',
          },
        },
      ],
    })).toThrow('Missing paymentCoinType')
  })

  it('falls back to effects.transactionDigest for dry-run publish results', () => {
    const deployment = extractDeploymentFromPublishResult({
      effects: {
        transactionDigest: '0xdryrundigest',
      },
      objectChanges: [
        { type: 'published', packageId: '0xpackage' },
        { objectType: '0x2::package::UpgradeCap', objectId: '0xupgradecap' },
      ],
      events: [
        {
          type: '0xpackage::market::MarketInitialized',
          parsedJson: {
            config_id: '0xconfig',
            registry_id: '0xregistry',
            soul_policy_id: '0xsoulpolicy',
            collection_policy_id: '0xcollectionpolicy',
          },
        },
        {
          type: '0xpackage::market::MarketUpgradeStateInitialized',
          parsedJson: {
            upgrade_state_id: '0xupgradestate',
          },
        },
      ],
    }, {
      paymentCoinType: '0x2::coin::COIN',
    })

    expect(deployment.publishTxDigest).toBe('0xdryrundigest')
  })

  it('extracts the 5 cap/display ids using packageId-templated objectType strings', () => {
    const pkg = '0xabc123'
    const deployment = extractDeploymentFromPublishResult({
      digest: '0xdigest',
      objectChanges: [
        { type: 'published', packageId: pkg },
        { objectType: '0x2::package::UpgradeCap', objectId: '0xupgradecap' },
        { objectType: `${pkg}::market::MarketAdminCap`, objectId: '0xadmincap' },
        // Decoy: another TransferPolicyCap of an unrelated type — must NOT be picked
        { objectType: '0x2::transfer_policy::TransferPolicyCap<0xdead::nft::Other>', objectId: '0xdecoy' },
        { objectType: `0x2::transfer_policy::TransferPolicyCap<${pkg}::soul::Soul>`, objectId: '0xsoulpolicycap' },
        { objectType: `0x2::transfer_policy::TransferPolicyCap<${pkg}::collection::SoulCollectionRight>`, objectId: '0xcollectionpolicycap' },
        { objectType: `0x2::display::Display<${pkg}::soul::Soul>`, objectId: '0xsouldisplay' },
        { objectType: `0x2::display::Display<${pkg}::collection::SoulCollectionRight>`, objectId: '0xcollectiondisplay' },
      ],
      events: [
        {
          type: `${pkg}::market::MarketInitialized`,
          parsedJson: {
            config_id: '0xconfig',
            registry_id: '0xregistry',
            soul_policy_id: '0xsoulpolicy',
            collection_policy_id: '0xcollectionpolicy',
          },
        },
        {
          type: `${pkg}::market::MarketUpgradeStateInitialized`,
          parsedJson: { upgrade_state_id: '0xupgradestate' },
        },
      ],
    }, { paymentCoinType: '0x2::coin::COIN' })

    expect(deployment.marketAdminCapId).toBe('0xadmincap')
    expect(deployment.soulPolicyCapId).toBe('0xsoulpolicycap')
    expect(deployment.collectionPolicyCapId).toBe('0xcollectionpolicycap')
    expect(deployment.soulDisplayId).toBe('0xsouldisplay')
    expect(deployment.collectionDisplayId).toBe('0xcollectiondisplay')
  })
})

// ── parseArgs ──────────────────────────────────────────────

describe('parseArgs', () => {
  it('defaults to safe values', () => {
    const args = parseArgs([])
    expect(args).toEqual({
      dryRun: false,
      dryRunTransferOnly: false,
      resumeCapTransferFromManifest: false,
      useEnvKey: false,
      gasBudget: null,
      paymentCoinType: null,
      transferCapsTo: null,
      trackUpgradeCap: true,
      privKeyEnv: 'MAINNET_DEPLOYER_PRIV_KEY',
    })
  })

  it('parses --transfer-caps-to in both = and space forms', () => {
    expect(parseArgs(['--transfer-caps-to=0xabc']).transferCapsTo).toBe('0xabc')
    expect(parseArgs(['--transfer-caps-to', '0xdef']).transferCapsTo).toBe('0xdef')
  })

  it('parses --no-track-upgrade-cap to disable tracking', () => {
    expect(parseArgs(['--no-track-upgrade-cap']).trackUpgradeCap).toBe(false)
    expect(parseArgs([]).trackUpgradeCap).toBe(true)
  })

  it('parses resume + dry-run-transfer-only flags', () => {
    const args = parseArgs(['--resume-cap-transfer-from-manifest', '--dry-run-transfer-only'])
    expect(args.resumeCapTransferFromManifest).toBe(true)
    expect(args.dryRunTransferOnly).toBe(true)
  })

  it('honors --mainnet-priv-key-env override', () => {
    expect(parseArgs(['--mainnet-priv-key-env=CUSTOM_KEY']).privKeyEnv).toBe('CUSTOM_KEY')
  })
})

// ── buildCapTransferPtb ────────────────────────────────────

describe('buildCapTransferPtb', () => {
  const completeDeployment = {
    packageId: '0xpkg',
    marketConfigId: '0xconfig',
    kioskRegistryId: '0xregistry',
    soulTransferPolicyId: '0xsoulpolicy',
    collectionTransferPolicyId: '0xcollectionpolicy',
    paymentCoinType: '0x2::coin::COIN',
    upgradeCapId: '0xupgradecap',
    upgradeStateId: '0xupgradestate',
    marketAdminCapId: '0xadmincap',
    soulPolicyCapId: '0xsoulpolicycap',
    collectionPolicyCapId: '0xcollectionpolicycap',
    soulDisplayId: '0xsouldisplay',
    collectionDisplayId: '0xcollectiondisplay',
  }

  it('throws when any required field is missing', () => {
    expect(() => buildCapTransferPtb(
      { ...completeDeployment, marketAdminCapId: undefined },
      '0x' + 'a'.repeat(64),
      true,
      '0x' + 'b'.repeat(64),
    )).toThrow(/marketAdminCapId is missing/)
  })

  it('builds a transaction with track_upgrade_cap when enabled', () => {
    expect(() => buildCapTransferPtb(
      completeDeployment,
      '0x' + 'a'.repeat(64),
      true,
      '0x' + 'b'.repeat(64),
    )).not.toThrow()
  })

  it('omits track_upgrade_cap when disabled but still transfers all 6 caps', () => {
    expect(() => buildCapTransferPtb(
      completeDeployment,
      '0x' + 'a'.repeat(64),
      false,
      '0x' + 'b'.repeat(64),
    )).not.toThrow()
  })

  it('throws when each individual required field is missing', () => {
    const requiredFields = [
      'upgradeStateId',
      'marketAdminCapId',
      'upgradeCapId',
      'soulPolicyCapId',
      'collectionPolicyCapId',
      'soulDisplayId',
      'collectionDisplayId',
    ] as const
    for (const field of requiredFields) {
      expect(() => buildCapTransferPtb(
        { ...completeDeployment, [field]: undefined },
        '0x' + 'a'.repeat(64),
        true,
        '0x' + 'b'.repeat(64),
      )).toThrow(new RegExp(`${field} is missing`))
    }
  })
})

// ── Published.toml read/write ──────────────────────────────

describe('Published.toml section preservation', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'soulidity-published-toml-'))
    path = join(dir, 'Published.toml')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('parses an existing file with one section', () => {
    writeFileSync(path, [
      '# Header',
      '',
      '[published.testnet]',
      'chain-id = "4c78adac"',
      'published-at = "0xabc"',
      'version = 1',
      '',
    ].join('\n'))
    const sections = readPublishedTomlSections(path)
    expect(Object.keys(sections)).toEqual(['testnet'])
    expect(sections.testnet).toContain('chain-id = "4c78adac"')
  })

  it('writes a new section while preserving an existing one', () => {
    writeFileSync(path, [
      '# Header',
      '',
      '[published.testnet]',
      'chain-id = "4c78adac"',
      'published-at = "0xtestnet"',
      'original-id = "0xtestnet"',
      'version = 1',
      'toolchain-version = "1.69.2"',
      'build-config = { flavor = "sui", edition = "2024" }',
      'upgrade-capability = "0xtestnetcap"',
      '',
    ].join('\n'))

    writePublishedTomlSection(path, 'mainnet', {
      chainId: '35834a8a',
      packageId: '0xmainnet',
      version: 1,
      toolchainVersion: '1.70.2',
      upgradeCapId: '0xmainnetcap',
    })

    const after = readFileSync(path, 'utf8')
    expect(after).toContain('[published.testnet]')
    expect(after).toContain('chain-id = "4c78adac"')
    expect(after).toContain('upgrade-capability = "0xtestnetcap"')
    expect(after).toContain('[published.mainnet]')
    expect(after).toContain('chain-id = "35834a8a"')
    expect(after).toContain('published-at = "0xmainnet"')
    expect(after).toContain('upgrade-capability = "0xmainnetcap"')
  })

  it('overwrites an existing section in place without duplicating', () => {
    writePublishedTomlSection(path, 'mainnet', {
      chainId: 'aaaa1111',
      packageId: '0xold',
      version: 1,
      toolchainVersion: '1.70.0',
      upgradeCapId: '0xoldcap',
    })
    writePublishedTomlSection(path, 'mainnet', {
      chainId: 'bbbb2222',
      packageId: '0xnew',
      version: 1,
      toolchainVersion: '1.70.2',
      upgradeCapId: '0xnewcap',
    })

    const sections = readPublishedTomlSections(path)
    expect(Object.keys(sections)).toEqual(['mainnet'])
    expect(sections.mainnet).toContain('published-at = "0xnew"')
    expect(sections.mainnet).not.toContain('0xold')
  })
})
