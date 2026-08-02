import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildCapTransferPtb,
  assertLegacyCliPublishAllowed,
  assertNoPendingReleaseAttempt,
  assertHistoricalSealRoutePreserved,
  assertMainnetFreshPublishAllowed,
  extractDeploymentFromPublishResult,
  parseArgs,
  persistReconciledFreshPublishRecords,
  readReleaseAttempt,
  readPublishedTomlSections,
  reconcileFreshPublishResult,
  verifyCapTransferOwners,
  verifyFreshDeploymentOnChain,
  writePublishedTomlSection,
} from '../../scripts/publish-soulidity-and-sync'

describe('signed release-attempt journal', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'soulidity-release-attempt-'))
    path = join(dir, 'deployment-release-attempt.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('accepts only an explicit null journal as idle', () => {
    writeFileSync(path, 'null\n')
    expect(readReleaseAttempt(path)).toBeNull()
    expect(() => assertNoPendingReleaseAttempt(path)).not.toThrow()
  })

  it('fails closed when the journal is missing or malformed', () => {
    expect(() => readReleaseAttempt(path)).toThrow(/journal is missing/)
    writeFileSync(path, '{}\n')
    expect(() => readReleaseAttempt(path)).toThrow(/malformed/)
  })

  it('durably blocks retry while a signed operation is unresolved', () => {
    writeFileSync(path, JSON.stringify({
      operation: 'fresh-publish',
      network: 'mainnet',
      status: 'submitted',
      startedAt: '2026-08-01T00:00:00.000Z',
      deployerAddr: '0xaa',
      digest: 'submitted-digest',
    }))
    expect(() => assertNoPendingReleaseAttempt(path)).toThrow(
      /DO NOT RETRY.*reconciled/,
    )
  })
})

function completePublishObjectChanges(packageId: string) {
  return [
    { type: 'published', packageId },
    { objectType: '0x2::package::UpgradeCap', objectId: '0xupgradecap' },
    { objectType: `${packageId}::market::MarketAdminCap`, objectId: '0xadmincap' },
    { objectType: `${packageId}::kind_registry::KindAdminCap`, objectId: '0xkindadmincap' },
    { objectType: `0x2::transfer_policy::TransferPolicyCap<${packageId}::soul::Soul>`, objectId: '0xsoulpolicycap' },
    { objectType: `0x2::transfer_policy::TransferPolicyCap<${packageId}::collection::SoulCollectionRight>`, objectId: '0xcollectionpolicycap' },
    { objectType: `0x2::display::Display<${packageId}::soul::Soul>`, objectId: '0xsouldisplay' },
    { objectType: `0x2::display::Display<${packageId}::collection::SoulCollectionRight>`, objectId: '0xcollectiondisplay' },
  ]
}

// ── extractDeploymentFromPublishResult ─────────────────────

describe('extractDeploymentFromPublishResult', () => {
  it('extracts the core deployment ids from a publish result', () => {
    const deployment = extractDeploymentFromPublishResult({
      digest: '6XqMK1KoLFXTP4gg4rVraN4vqzTJ28kQp7iPR7wkhdLd',
      objectChanges: completePublishObjectChanges('0xpackage'),
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
          type: '0xpackage::kind_registry::KindRegistryCreated',
          parsedJson: {
            registry_id: '0xkindregistry',
            admin_cap_id: '0xkindadmincap',
          },
        },
      ],
    }, {
      paymentCoinType: '0x2::coin::COIN',
    })

    expect(deployment).toMatchObject({
      callablePackageId: '0xpackage',
      originalPackageId: '0xpackage',
      animacraftProvenancePackageId: '0xpackage',
      packageId: '0xpackage',
      marketConfigId: '0xconfig',
      marketConfigV2PackageId: '0xpackage',
      kioskRegistryId: '0xregistry',
      kindRegistryId: '0xkindregistry',
      soulTransferPolicyId: '0xsoulpolicy',
      collectionTransferPolicyId: '0xcollectionpolicy',
      paymentCoinType: '0x2::coin::COIN',
      publishTxDigest: '6XqMK1KoLFXTP4gg4rVraN4vqzTJ28kQp7iPR7wkhdLd',
      upgradeCapId: '0xupgradecap',
      kindAdminCapId: '0xkindadmincap',
    })
  })

  it('fails fast when payment coin type cannot be resolved', () => {
    expect(() => extractDeploymentFromPublishResult({
      digest: '0xdigest',
      objectChanges: completePublishObjectChanges('0xpackage'),
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
          type: '0xpackage::kind_registry::KindRegistryCreated',
          parsedJson: {
            registry_id: '0xkindregistry',
            admin_cap_id: '0xkindadmincap',
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
      objectChanges: completePublishObjectChanges('0xpackage'),
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
          type: '0xpackage::kind_registry::KindRegistryCreated',
          parsedJson: {
            registry_id: '0xkindregistry',
            admin_cap_id: '0xkindadmincap',
          },
        },
      ],
    }, {
      paymentCoinType: '0x2::coin::COIN',
    })

    expect(deployment.publishTxDigest).toBe('0xdryrundigest')
  })

  it('extracts the cap/display ids using packageId-templated objectType strings', () => {
    const pkg = '0xabc123'
    const deployment = extractDeploymentFromPublishResult({
      digest: '0xdigest',
      objectChanges: [
        { type: 'published', packageId: pkg },
        { objectType: '0x2::package::UpgradeCap', objectId: '0xupgradecap' },
        { objectType: `${pkg}::market::MarketAdminCap`, objectId: '0xadmincap' },
        { objectType: `${pkg}::kind_registry::KindAdminCap`, objectId: '0xkindadmincap' },
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
          type: `${pkg}::kind_registry::KindRegistryCreated`,
          parsedJson: {
            registry_id: '0xkindregistry',
            admin_cap_id: '0xkindadmincap-from-event',
          },
        },
      ],
    }, { paymentCoinType: '0x2::coin::COIN' })

    expect(deployment.marketAdminCapId).toBe('0xadmincap')
    expect(deployment.kindRegistryId).toBe('0xkindregistry')
    expect(deployment.kindAdminCapId).toBe('0xkindadmincap')
    expect(deployment.soulPolicyCapId).toBe('0xsoulpolicycap')
    expect(deployment.collectionPolicyCapId).toBe('0xcollectionpolicycap')
    expect(deployment.soulDisplayId).toBe('0xsouldisplay')
    expect(deployment.collectionDisplayId).toBe('0xcollectiondisplay')
  })

  it('accepts gRPC Core object types with fully padded framework addresses', () => {
    const pkg = '0xabc123'
    const paddedFramework = `0x${'0'.repeat(63)}2`
    const deployment = extractDeploymentFromPublishResult({
      digest: '0xdigest',
      objectChanges: completePublishObjectChanges(pkg).map((change) => ({
        ...change,
        objectType: change.objectType?.replace(/^0x2::/, `${paddedFramework}::`),
      })),
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
          type: `${pkg}::kind_registry::KindRegistryCreated`,
          parsedJson: {
            registry_id: '0xkindregistry',
            admin_cap_id: '0xkindadmincap',
          },
        },
      ],
    }, { paymentCoinType: '0x2::coin::COIN' })

    expect(deployment.upgradeCapId).toBe('0xupgradecap')
    expect(deployment.soulPolicyCapId).toBe('0xsoulpolicycap')
    expect(deployment.soulDisplayId).toBe('0xsouldisplay')
  })

  it('rejects a publish response that omits a governance object', () => {
    const packageId = '0xpackage'
    expect(() => extractDeploymentFromPublishResult({
      digest: '0xdigest',
      objectChanges: completePublishObjectChanges(packageId).filter(
        (change) => change.objectId !== '0xsouldisplay',
      ),
      events: [
        {
          type: `${packageId}::market::MarketInitialized`,
          parsedJson: {
            config_id: '0xconfig',
            registry_id: '0xregistry',
            soul_policy_id: '0xsoulpolicy',
            collection_policy_id: '0xcollectionpolicy',
          },
        },
        {
          type: `${packageId}::kind_registry::KindRegistryCreated`,
          parsedJson: {
            registry_id: '0xkindregistry',
            admin_cap_id: '0xkindadmincap',
          },
        },
      ],
    }, { paymentCoinType: '0x2::coin::COIN' })).toThrow(/Soul display id/)
  })
})

// ── finalized object readback ──────────────────────────────

const READBACK_PACKAGE = '0x11'
const READBACK_DEPLOYER = '0xaa'
const READBACK_MULTISIG = '0xbb'

const readbackDeployment = {
  callablePackageId: READBACK_PACKAGE,
  originalPackageId: READBACK_PACKAGE,
  animacraftProvenancePackageId: READBACK_PACKAGE,
  packageId: READBACK_PACKAGE,
  marketConfigId: '0x21',
  marketConfigV2PackageId: READBACK_PACKAGE,
  kioskRegistryId: '0x22',
  kindRegistryId: '0x23',
  soulTransferPolicyId: '0x24',
  collectionTransferPolicyId: '0x25',
  paymentCoinType: '0x2::sui::SUI',
  publishTxDigest: 'digest',
  upgradeCapId: '0x26',
  marketAdminCapId: '0x27',
  kindAdminCapId: '0x28',
  soulPolicyCapId: '0x29',
  collectionPolicyCapId: '0x2a',
  soulDisplayId: '0x2b',
  collectionDisplayId: '0x2c',
}

function moveObject(params: {
  objectId: string
  type: string
  owner: string | 'shared'
  fields?: Record<string, unknown>
}) {
  return {
    data: {
      objectId: params.objectId,
      type: params.type,
      owner: params.owner === 'shared'
        ? { Shared: { initial_shared_version: '1' } }
        : { AddressOwner: params.owner },
      content: {
        dataType: 'moveObject' as const,
        type: params.type,
        hasPublicTransfer: true,
        fields: params.fields ?? { id: { id: params.objectId } },
      },
    },
  }
}

function readbackObjects(owner = READBACK_DEPLOYER, paused = true) {
  const pkg = READBACK_PACKAGE
  return new Map<string, ReturnType<typeof moveObject>>([
    [readbackDeployment.marketConfigId, moveObject({
      objectId: readbackDeployment.marketConfigId,
      type: `${pkg}::market::MarketConfig`,
      owner: 'shared',
      fields: {
        id: { id: readbackDeployment.marketConfigId },
        version: '1',
        fee_recipient: READBACK_DEPLOYER,
        platform_fee_bps: '1000',
        paused,
      },
    })],
    [readbackDeployment.marketAdminCapId, moveObject({
      objectId: readbackDeployment.marketAdminCapId,
      type: `${pkg}::market::MarketAdminCap`,
      owner,
    })],
    [readbackDeployment.upgradeCapId, moveObject({
      objectId: readbackDeployment.upgradeCapId,
      type: '0x2::package::UpgradeCap',
      owner,
      fields: {
        id: { id: readbackDeployment.upgradeCapId },
        package: pkg,
        policy: 0,
        version: '1',
      },
    })],
    [readbackDeployment.kioskRegistryId, moveObject({
      objectId: readbackDeployment.kioskRegistryId,
      type: `${pkg}::market::KioskRegistry`,
      owner: 'shared',
    })],
    [readbackDeployment.kindRegistryId, moveObject({
      objectId: readbackDeployment.kindRegistryId,
      type: `${pkg}::kind_registry::KindRegistry`,
      owner: 'shared',
    })],
    [readbackDeployment.soulTransferPolicyId, moveObject({
      objectId: readbackDeployment.soulTransferPolicyId,
      type: `0x2::transfer_policy::TransferPolicy<${pkg}::soul::Soul>`,
      owner: 'shared',
    })],
    [readbackDeployment.collectionTransferPolicyId, moveObject({
      objectId: readbackDeployment.collectionTransferPolicyId,
      type: `0x2::transfer_policy::TransferPolicy<${pkg}::collection::SoulCollectionRight>`,
      owner: 'shared',
    })],
    [readbackDeployment.kindAdminCapId, moveObject({
      objectId: readbackDeployment.kindAdminCapId,
      type: `${pkg}::kind_registry::KindAdminCap`,
      owner,
    })],
    [readbackDeployment.soulPolicyCapId, moveObject({
      objectId: readbackDeployment.soulPolicyCapId,
      type: `0x2::transfer_policy::TransferPolicyCap<${pkg}::soul::Soul>`,
      owner,
    })],
    [readbackDeployment.collectionPolicyCapId, moveObject({
      objectId: readbackDeployment.collectionPolicyCapId,
      type: `0x2::transfer_policy::TransferPolicyCap<${pkg}::collection::SoulCollectionRight>`,
      owner,
    })],
    [readbackDeployment.soulDisplayId, moveObject({
      objectId: readbackDeployment.soulDisplayId,
      type: `0x2::display::Display<${pkg}::soul::Soul>`,
      owner,
    })],
    [readbackDeployment.collectionDisplayId, moveObject({
      objectId: readbackDeployment.collectionDisplayId,
      type: `0x2::display::Display<${pkg}::collection::SoulCollectionRight>`,
      owner,
    })],
  ])
}

function readbackClient(objects: Map<string, ReturnType<typeof moveObject>>) {
  return {
    getObject: vi.fn(async ({ id }: { id: string }) => {
      const object = objects.get(id)
      if (!object) return { error: { code: 'notExists', object_id: id } }
      return object
    }),
  }
}

describe('finalized fresh deployment readback', () => {
  it('accepts a complete paused deployment owned by the deployer', async () => {
    const client = readbackClient(readbackObjects())
    await expect(verifyFreshDeploymentOnChain({
      client: client as never,
      deployment: readbackDeployment,
      deployerAddr: READBACK_DEPLOYER,
    })).resolves.toEqual({ paused: true })
    expect(client.getObject).toHaveBeenCalledTimes(12)
  })

  it('rejects a fresh deployment whose market is active', async () => {
    await expect(verifyFreshDeploymentOnChain({
      client: readbackClient(readbackObjects(READBACK_DEPLOYER, false)) as never,
      deployment: readbackDeployment,
      deployerAddr: READBACK_DEPLOYER,
    })).rejects.toThrow(/expected paused=true/)
  })

  it('rejects a fresh deployment whose capability owner is wrong', async () => {
    await expect(verifyFreshDeploymentOnChain({
      client: readbackClient(readbackObjects(READBACK_MULTISIG)) as never,
      deployment: readbackDeployment,
      deployerAddr: READBACK_DEPLOYER,
    })).rejects.toThrow(/owner is .* expected/)
  })
})

describe('fresh-publish reconciliation', () => {
  it('reconciles a submitted digest using reads and verifies every deployment object', async () => {
    const client = readbackClient(readbackObjects())
    const deployment = await reconcileFreshPublishResult({
      client: client as never,
      attempt: {
        operation: 'fresh-publish',
        network: 'mainnet',
        status: 'submitted',
        startedAt: '2026-08-02T00:00:00.000Z',
        deployerAddr: READBACK_DEPLOYER,
        priorPackageId: '0x10',
        digest: 'digest',
      },
      result: {
        digest: 'digest',
        effects: { status: { status: 'success' } },
        objectChanges: [
          { type: 'published', packageId: READBACK_PACKAGE },
          { objectType: '0x2::package::UpgradeCap', objectId: readbackDeployment.upgradeCapId },
          { objectType: `${READBACK_PACKAGE}::market::MarketAdminCap`, objectId: readbackDeployment.marketAdminCapId },
          { objectType: `${READBACK_PACKAGE}::kind_registry::KindAdminCap`, objectId: readbackDeployment.kindAdminCapId },
          { objectType: `0x2::transfer_policy::TransferPolicyCap<${READBACK_PACKAGE}::soul::Soul>`, objectId: readbackDeployment.soulPolicyCapId },
          { objectType: `0x2::transfer_policy::TransferPolicyCap<${READBACK_PACKAGE}::collection::SoulCollectionRight>`, objectId: readbackDeployment.collectionPolicyCapId },
          { objectType: `0x2::display::Display<${READBACK_PACKAGE}::soul::Soul>`, objectId: readbackDeployment.soulDisplayId },
          { objectType: `0x2::display::Display<${READBACK_PACKAGE}::collection::SoulCollectionRight>`, objectId: readbackDeployment.collectionDisplayId },
        ],
        events: [
          {
            type: `${READBACK_PACKAGE}::market::MarketInitialized`,
            parsedJson: {
              config_id: readbackDeployment.marketConfigId,
              registry_id: readbackDeployment.kioskRegistryId,
              soul_policy_id: readbackDeployment.soulTransferPolicyId,
              collection_policy_id: readbackDeployment.collectionTransferPolicyId,
            },
          },
          {
            type: `${READBACK_PACKAGE}::kind_registry::KindRegistryCreated`,
            parsedJson: {
              registry_id: readbackDeployment.kindRegistryId,
              admin_cap_id: readbackDeployment.kindAdminCapId,
            },
          },
        ],
      },
      previousDeployment: {
        callablePackageId: '0x10',
        paymentCoinType: '0x2::sui::SUI',
      },
    })

    expect(deployment).toEqual(readbackDeployment)
    expect(client.getObject).toHaveBeenCalledTimes(12)
  })

  it('persists only the target environment and archives the prior family exactly once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'soulidity-reconcile-records-'))
    try {
      const manifestFile = join(dir, 'deployment-manifest.json')
      const historyFile = join(dir, 'deployment-manifest-history.json')
      const publishedTomlFile = join(dir, 'Published.toml')
      const previousDeployment = {
        ...readbackDeployment,
        callablePackageId: '0x10',
        originalPackageId: '0x10',
        animacraftProvenancePackageId: '0x10',
        packageId: '0x10',
        publishTxDigest: 'old-digest',
      }
      const testnetDeployment = {
        ...readbackDeployment,
        callablePackageId: '0x12',
        originalPackageId: '0x12',
        animacraftProvenancePackageId: '0x12',
        packageId: '0x12',
      }
      writeFileSync(manifestFile, `${JSON.stringify({
        mainnet: previousDeployment,
        testnet: testnetDeployment,
      }, null, 2)}\n`)
      writeFileSync(historyFile, '[]\n')
      writeFileSync(publishedTomlFile, [
        '# Generated by Move',
        '[published.testnet]',
        'chain-id = "testnet-chain"',
        'published-at = "0x12"',
        'original-id = "0x12"',
        'version = 1',
        'toolchain-version = "1.76.1"',
        'build-config = { flavor = "sui", edition = "2024" }',
        'upgrade-capability = "0x26"',
        '',
      ].join('\n'))

      const first = persistReconciledFreshPublishRecords({
        network: 'mainnet',
        deployment: readbackDeployment,
        previousDeployment,
        chainId: '35834a8a',
        toolchainVersion: '1.76.1',
        manifestFile,
        historyFile,
        publishedTomlFile,
      })
      const second = persistReconciledFreshPublishRecords({
        network: 'mainnet',
        deployment: readbackDeployment,
        previousDeployment,
        chainId: '35834a8a',
        toolchainVersion: '1.76.1',
        manifestFile,
        historyFile,
        publishedTomlFile,
      })

      expect(first.archivedPrevious).toBe(true)
      expect(second.archivedPrevious).toBe(false)
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
      expect(manifest.mainnet).toEqual(readbackDeployment)
      expect(manifest.testnet).toEqual(testnetDeployment)
      const history = JSON.parse(readFileSync(historyFile, 'utf8'))
      expect(history).toHaveLength(1)
      expect(history[0].deployment.packageId).toBe('0x10')
      expect(readPublishedTomlSections(publishedTomlFile).testnet).toContain(
        'published-at = "0x12"',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('finalized capability handoff readback', () => {
  it('accepts only after every transferred object belongs to the target', async () => {
    const client = readbackClient(readbackObjects(READBACK_MULTISIG))
    await expect(verifyCapTransferOwners({
      client: client as never,
      deployment: readbackDeployment,
      expectedOwner: READBACK_MULTISIG,
    })).resolves.toBeUndefined()
    expect(client.getObject).toHaveBeenCalledTimes(7)
  })

  it('rejects when even one transferred object still belongs to the deployer', async () => {
    const objects = readbackObjects(READBACK_MULTISIG)
    objects.set(readbackDeployment.soulDisplayId, moveObject({
      objectId: readbackDeployment.soulDisplayId,
      type: `0x2::display::Display<${READBACK_PACKAGE}::soul::Soul>`,
      owner: READBACK_DEPLOYER,
    }))
    await expect(verifyCapTransferOwners({
      client: readbackClient(objects) as never,
      deployment: readbackDeployment,
      expectedOwner: READBACK_MULTISIG,
    })).rejects.toThrow(/Soul display owner is .* expected/)
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
      reconcileFreshPublishFromJournal: false,
      useEnvKey: false,
      mainnetE2e: false,
      gasBudget: null,
      paymentCoinType: null,
      transferCapsTo: null,
      privKeyEnv: 'MAINNET_DEPLOYER_PRIV_KEY',
      breakGlassAllowMainnetFreshPublish: false,
      breakGlassConfirm: null,
    })
  })

  it('parses --mainnet-e2e', () => {
    expect(parseArgs(['--mainnet-e2e']).mainnetE2e).toBe(true)
    expect(parseArgs([]).mainnetE2e).toBe(false)
  })

  it('parses isolated fresh-publish reconciliation mode', () => {
    expect(parseArgs(['--reconcile-fresh-publish-from-journal'])
      .reconcileFreshPublishFromJournal).toBe(true)
  })

  it('parses --transfer-caps-to in both = and space forms', () => {
    expect(parseArgs(['--transfer-caps-to=0xabc']).transferCapsTo).toBe('0xabc')
    expect(parseArgs(['--transfer-caps-to', '0xdef']).transferCapsTo).toBe('0xdef')
  })

  it('parses resume + dry-run-transfer-only flags', () => {
    const args = parseArgs(['--resume-cap-transfer-from-manifest', '--dry-run-transfer-only'])
    expect(args.resumeCapTransferFromManifest).toBe(true)
    expect(args.dryRunTransferOnly).toBe(true)
  })

  it('honors --mainnet-priv-key-env override', () => {
    expect(parseArgs(['--mainnet-priv-key-env=CUSTOM_KEY']).privKeyEnv).toBe('CUSTOM_KEY')
  })

  it('parses the explicitly named mainnet fresh-publish break glass', () => {
    expect(parseArgs([
      '--break-glass-allow-mainnet-fresh-publish',
      '--break-glass-confirm=CREATE_NEW_SOULIDITY_MAINNET_PACKAGE_FAMILY',
    ])).toMatchObject({
      breakGlassAllowMainnetFreshPublish: true,
      breakGlassConfirm: 'CREATE_NEW_SOULIDITY_MAINNET_PACKAGE_FAMILY',
    })
  })

  it('rejects unknown flags and missing option values instead of silently publishing', () => {
    expect(() => parseArgs(['--exectue'])).toThrow(/Unknown argument/)
    expect(() => parseArgs(['--gas-budget'])).toThrow(/requires a value/)
    expect(() => parseArgs(['--break-glass-confirm', '--dry-run'])).toThrow(
      /requires a value/,
    )
  })
})

describe('mainnet fresh-publish guard', () => {
  const existing = {
    packageId: '0xexisting',
    originalPackageId: '0xexisting',
    callablePackageId: '0xexisting',
  }

  it('fails closed when a mainnet deployment already exists', () => {
    expect(() => assertMainnetFreshPublishAllowed('mainnet', {
      breakGlassAllowMainnetFreshPublish: false,
      breakGlassConfirm: null,
    }, existing)).toThrow(/mainnet already has a Soulidity package family/)
  })

  it('requires both the named flag and exact confirmation', () => {
    expect(() => assertMainnetFreshPublishAllowed('mainnet', {
      breakGlassAllowMainnetFreshPublish: true,
      breakGlassConfirm: 'wrong',
    }, existing)).toThrow(/CREATE_NEW_SOULIDITY_MAINNET_PACKAGE_FAMILY/)

    expect(() => assertMainnetFreshPublishAllowed('mainnet', {
      breakGlassAllowMainnetFreshPublish: true,
      breakGlassConfirm: 'CREATE_NEW_SOULIDITY_MAINNET_PACKAGE_FAMILY',
    }, existing)).not.toThrow()
  })

  it('does not block non-mainnet or an empty deployment slot', () => {
    expect(() => assertMainnetFreshPublishAllowed('testnet', {
      breakGlassAllowMainnetFreshPublish: false,
      breakGlassConfirm: null,
    }, existing)).not.toThrow()
    expect(() => assertMainnetFreshPublishAllowed('mainnet', {
      breakGlassAllowMainnetFreshPublish: false,
      breakGlassConfirm: null,
    }, undefined)).not.toThrow()
  })

  it('requires an explicit historical Seal route before replacing a Mainnet family', () => {
    const previous = {
      originalPackageId: '0x2',
      callablePackageId: '0x3',
    }

    expect(() => assertHistoricalSealRoutePreserved(
      'mainnet',
      previous,
      undefined,
    )).toThrow(/NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES is required/)
    expect(() => assertHistoricalSealRoutePreserved(
      'mainnet',
      previous,
      '[]',
    )).toThrow(/does not preserve the previous Mainnet family/)
    expect(() => assertHistoricalSealRoutePreserved(
      'mainnet',
      previous,
      JSON.stringify([{ sealPackageId: '0x2', callablePackageId: '0x4' }]),
    )).toThrow(/does not preserve the previous Mainnet family/)
  })

  it('accepts the previous family route after canonical Sui ID normalization', () => {
    expect(() => assertHistoricalSealRoutePreserved(
      'mainnet',
      {
        originalPackageId: '0x2',
        callablePackageId: `0x${'0'.repeat(63)}3`,
      },
      JSON.stringify([{
        sealPackageId: `0x${'0'.repeat(63)}2`,
        callablePackageId: '0x3',
      }]),
    )).not.toThrow()
  })

  it('rejects malformed or conflicting historical route payloads', () => {
    const previous = {
      originalPackageId: '0x2',
      callablePackageId: '0x3',
    }
    expect(() => assertHistoricalSealRoutePreserved(
      'mainnet',
      previous,
      '{',
    )).toThrow(/must be valid JSON/)
    expect(() => assertHistoricalSealRoutePreserved(
      'mainnet',
      previous,
      JSON.stringify([
        { sealPackageId: '0x2', callablePackageId: '0x3' },
        { sealPackageId: `0x${'0'.repeat(63)}2`, callablePackageId: '0x4' },
      ]),
    )).toThrow(/conflicts with callable/)
  })

  it('does not require historical routes for a first family or non-Mainnet publish', () => {
    expect(() => assertHistoricalSealRoutePreserved(
      'mainnet',
      undefined,
      undefined,
    )).not.toThrow()
    expect(() => assertHistoricalSealRoutePreserved(
      'testnet',
      existing,
      undefined,
    )).not.toThrow()
  })
})

describe('legacy CLI publish guard', () => {
  it('never permits the unjournaled CLI flow to publish on Mainnet', () => {
    expect(() => assertLegacyCliPublishAllowed('mainnet', true)).toThrow(
      /only the exact testnet environment is supported/,
    )
    expect(() => assertLegacyCliPublishAllowed('mainnet', false)).toThrow(
      /guarded SDK flow/,
    )
    expect(() => assertLegacyCliPublishAllowed('prod', true)).toThrow(
      /Network prod is not allowed/,
    )
    expect(() => assertLegacyCliPublishAllowed('custom-mainnet', false)).toThrow(
      /Network custom-mainnet is not allowed/,
    )
  })

  it('retains the legacy compatibility flow for Testnet dry-runs', () => {
    expect(() => assertLegacyCliPublishAllowed('testnet', true)).not.toThrow()
    expect(() => assertLegacyCliPublishAllowed('testnet', false)).toThrow(
      /Signed publishing is disabled/,
    )
  })
})

// ── buildCapTransferPtb ────────────────────────────────────

describe('buildCapTransferPtb', () => {
  const completeDeployment = {
    packageId: '0xpkg',
    marketConfigId: '0xconfig',
    kioskRegistryId: '0xregistry',
    kindRegistryId: '0xkindregistry',
    soulTransferPolicyId: '0xsoulpolicy',
    collectionTransferPolicyId: '0xcollectionpolicy',
    paymentCoinType: '0x2::coin::COIN',
    upgradeCapId: '0xupgradecap',
    marketAdminCapId: '0xadmincap',
    kindAdminCapId: '0xkindadmincap',
    soulPolicyCapId: '0xsoulpolicycap',
    collectionPolicyCapId: '0xcollectionpolicycap',
    soulDisplayId: '0xsouldisplay',
    collectionDisplayId: '0xcollectiondisplay',
  }

  it('throws when any required field is missing', () => {
    expect(() => buildCapTransferPtb(
      { ...completeDeployment, marketAdminCapId: undefined },
      '0x' + 'a'.repeat(64),
      '0x' + 'b'.repeat(64),
    )).toThrow(/marketAdminCapId is missing/)
  })

  it('builds a transaction that transfers governance caps without upgrade-state tracking', () => {
    expect(() => buildCapTransferPtb(
      completeDeployment,
      '0x' + 'a'.repeat(64),
      '0x' + 'b'.repeat(64),
    )).not.toThrow()
  })

  it('throws when each individual required field is missing', () => {
    const requiredFields = [
      'marketAdminCapId',
      'kindAdminCapId',
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
