import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { TransactionDataBuilder } from '@mysten/sui/transactions'

import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest'

import {
  assertNoPendingMainnetMutationAttempt,
  assertCanonicalMainnetDeployment,
  assertExecutionConfirmation,
  assertMainnetRpc,
  atomicPatchMainnetDeployment,
  beginMainnetMutationAttempt,
  clearMainnetMutationAttempt,
  initializeMainnetMutationJournal,
  readMainnetMutationAttempt,
  readDeploymentSnapshot,
  SOULIDITY_MAINNET_ADMIN,
  SOULIDITY_MAINNET_CHAIN_IDENTIFIER,
  SOULIDITY_MAINNET_CONFIRM_UPGRADE,
  SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL,
  SOULIDITY_MAINNET_GENESIS_DIGEST,
  SOULIDITY_MAINNET_LEGACY_ADMIN_CAP,
  SOULIDITY_MAINNET_LEGACY_CONFIG,
  SOULIDITY_MAINNET_MUTATION_ATTEMPT_PATH,
  SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
  SOULIDITY_MAINNET_UPGRADE_CAP,
  updateMainnetMutationAttempt,
} from '../../scripts/lib/soulidity-mainnet-migration'
import { assertLegacyPauseAbort } from '../../scripts/preflight-animacraft-market-retirement'
import {
  buildLegacyRetirementTransaction,
  extractRetirementObjectIds,
  parseRetirementArgs,
  reconcileMarketMutationFromJournal,
} from '../../scripts/retire-soulidity-legacy-market'
import {
  buildUpgradeTransaction,
  parseUpgradeArgs,
  reconcileUpgradeFromJournal,
  renderUpdatedPublishedToml,
  validateBuiltMovePackage,
} from '../../scripts/upgrade-soulidity-mainnet'

const CALLABLE = `0x${'9'.repeat(64)}`
const CONFIG_V2 = `0x${'a'.repeat(64)}`
const ADMIN_V2 = `0x${'b'.repeat(64)}`
const CONFIG_V6 = `0x${'c'.repeat(64)}`
const ADMIN_V6 = `0x${'d'.repeat(64)}`
const JOURNAL_BYTES_BASE64 = 'AA=='
const JOURNAL_SIGNATURE = 'AA=='
const JOURNAL_DIGEST = TransactionDataBuilder.getDigestFromBytes(
  Buffer.from(JOURNAL_BYTES_BASE64, 'base64'),
)

describe('controlled Soulidity mainnet upgrade args', () => {
  it('defaults to dry-run without loading/signing intent', () => {
    expect(parseUpgradeArgs([])).toMatchObject({
      execute: false,
      reconcileFromJournal: false,
      confirm: null,
      writeManifest: false,
      privKeyEnv: 'MAINNET_DEPLOYER_PRIV_KEY',
    })
  })

  it('requires the exact execution confirmation and forbids dry-run writes', () => {
    expect(() => parseUpgradeArgs(['--execute'])).toThrow(
      SOULIDITY_MAINNET_CONFIRM_UPGRADE,
    )
    expect(() => parseUpgradeArgs([
      '--execute',
      '--confirm=not-enough',
    ])).toThrow(SOULIDITY_MAINNET_CONFIRM_UPGRADE)
    expect(() => parseUpgradeArgs(['--write-manifest'])).toThrow(
      /only allowed together with --execute/,
    )
    expect(() => parseUpgradeArgs([
      '--dry-run',
      '--execute',
      `--confirm=${SOULIDITY_MAINNET_CONFIRM_UPGRADE}`,
    ])).toThrow(/mutually exclusive/)
  })

  it('accepts the fully explicit execution gate', () => {
    expect(parseUpgradeArgs([
      '--execute',
      `--confirm=${SOULIDITY_MAINNET_CONFIRM_UPGRADE}`,
      '--write-manifest',
    ])).toMatchObject({
      execute: true,
      writeManifest: true,
    })
  })

  it('refuses to rewrite the v5 AnimacraftProvenance TypeOrigin during v6 upgrade', () => {
    expect(() => parseUpgradeArgs([
      '--record-animacraft-provenance-origin',
    ])).toThrow(/Unknown argument/)
  })

  it('isolates read-only journal reconciliation from every signing flag', () => {
    expect(parseUpgradeArgs(['--reconcile-from-journal'])).toMatchObject({
      execute: false,
      reconcileFromJournal: true,
    })
    expect(() => parseUpgradeArgs([
      '--reconcile-from-journal',
      '--execute',
      `--confirm=${SOULIDITY_MAINNET_CONFIRM_UPGRADE}`,
    ])).toThrow(/isolated read-only-chain mode/)
  })

  it('isolates one-time journal initialization from execution and reconciliation', () => {
    expect(parseUpgradeArgs([
      '--initialize-mutation-journal',
      `--confirm=${SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL}`,
    ])).toMatchObject({ initializeMutationJournal: true, execute: false })
    expect(() => parseUpgradeArgs([
      '--initialize-mutation-journal',
      '--execute',
      `--confirm=${SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL}`,
    ])).toThrow(/isolated local-state operation/)
    expect(() => parseUpgradeArgs(['--initialize-mutation-journal'])).toThrow(
      SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL,
    )
  })
})

describe('mainnet transport binding', () => {
  function clientFor(identifier: string) {
    return {
      getChainIdentifier: async () => identifier,
    } as unknown as SuiJsonRpcClient
  }

  it('accepts the exact legacy short identifier and the gRPC genesis digest', async () => {
    await expect(assertMainnetRpc(
      clientFor(SOULIDITY_MAINNET_CHAIN_IDENTIFIER),
    )).resolves.toBeUndefined()
    await expect(assertMainnetRpc(
      clientFor(SOULIDITY_MAINNET_GENESIS_DIGEST),
    )).resolves.toBeUndefined()
  })

  it('rejects partial or different chain identifiers', async () => {
    await expect(assertMainnetRpc(
      clientFor(`${SOULIDITY_MAINNET_GENESIS_DIGEST}x`),
    )).rejects.toThrow(/Refusing RPC chain/)
    await expect(assertMainnetRpc(clientFor('testnet'))).rejects.toThrow(
      /Refusing RPC chain/,
    )
    await expect(assertMainnetRpc(
      clientFor(SOULIDITY_MAINNET_GENESIS_DIGEST.toLowerCase()),
    )).rejects.toThrow(/Refusing RPC chain/)
  })
})

describe('upgrade build and PTB validation', () => {
  const built = {
    modules: ['AAAA'],
    dependencies: [`0x${'2'.padStart(64, '0')}`],
    digest: Array.from({ length: 32 }, (_, index) => index),
  }

  it('requires a complete toolchain-emitted digest', () => {
    expect(validateBuiltMovePackage(built)).toMatchObject({
      modules: ['AAAA'],
      digest: built.digest,
    })
    expect(() => validateBuiltMovePackage({
      ...built,
      digest: [1, 2],
    })).toThrow(/32-byte upgrade digest/)
  })

  it('builds authorize -> Upgrade -> commit as one PTB', () => {
    const tx = buildUpgradeTransaction({
      currentPackageId: SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
      upgradeCapId: SOULIDITY_MAINNET_UPGRADE_CAP,
      policy: 0,
      built,
    })
    const data = JSON.parse(JSON.stringify(tx.getData()))
    expect(data.commands).toHaveLength(3)
    expect(data.commands[0].MoveCall.function).toBe('authorize_upgrade')
    expect(data.commands[1].$kind).toBe('Upgrade')
    expect(data.commands[2].MoveCall.function).toBe('commit_upgrade')
  })

  it('updates only the mainnet callable package while preserving its original TypeOrigin', () => {
    const current = SOULIDITY_MAINNET_ORIGINAL_PACKAGE
    const testnetSection = [
      '[published.testnet]',
      'chain-id = "testnet-chain"',
      'published-at = "0xtestnet"',
      'original-id = "0xtestnet"',
      'version = 7',
    ].join('\n')
    const next = renderUpdatedPublishedToml({
      content: [
        '# Generated by Move',
        '',
        '[published.mainnet]',
        'chain-id = "35834a8a"',
        `published-at = "${current}"`,
        `original-id = "${current}"`,
        'version = 1',
        'toolchain-version = "1.74.1"',
        'build-config = { flavor = "sui", edition = "2024" }',
        `upgrade-capability = "${SOULIDITY_MAINNET_UPGRADE_CAP}"`,
        '',
        testnetSection,
        '',
      ].join('\n'),
      currentPackageId: current,
      callablePackageId: CALLABLE,
      originalPackageId: current,
      upgradeCapId: SOULIDITY_MAINNET_UPGRADE_CAP,
      version: 2n,
      toolchainVersion: '1.75.0',
    })
    expect(next).toContain(`published-at = "${CALLABLE}"`)
    expect(next).toContain(`original-id = "${current}"`)
    expect(next).toContain('version = 2')
    expect(next).not.toContain(`original-id = "${CALLABLE}"`)
    expect(next).toContain(testnetSection)
  })
})

describe('retirement controls', () => {
  it('defaults to a retirement dry-run and separately gates pause/retire execution', () => {
    expect(parseRetirementArgs([])).toMatchObject({
      execute: false,
      reconcileFromJournal: false,
      pauseOnly: false,
      writeManifest: false,
    })
    expect(() => parseRetirementArgs([
      '--pause-only',
      '--execute',
      '--confirm=RETIRE_SOULIDITY_LEGACY_MARKET_MAINNET',
    ])).toThrow(/PAUSE_SOULIDITY_LEGACY_MARKET_MAINNET/)
    expect(() => parseRetirementArgs([
      '--execute',
      '--confirm=RETIRE_SOULIDITY_LEGACY_MARKET_MAINNET',
      '--write-manifest',
    ])).not.toThrow()
    expect(() => parseRetirementArgs([
      '--dry-run',
      '--execute',
      '--confirm=RETIRE_SOULIDITY_LEGACY_MARKET_MAINNET',
    ])).toThrow(/mutually exclusive/)
  })

  it('isolates market journal reconciliation from pause and signing flags', () => {
    expect(parseRetirementArgs(['--reconcile-from-journal'])).toMatchObject({
      execute: false,
      reconcileFromJournal: true,
    })
    expect(() => parseRetirementArgs([
      '--reconcile-from-journal',
      '--pause-only',
    ])).toThrow(/isolated read-only-chain mode/)
  })

  it('isolates market journal initialization from every chain mode', () => {
    expect(parseRetirementArgs([
      '--initialize-mutation-journal',
      `--confirm=${SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL}`,
    ])).toMatchObject({ initializeMutationJournal: true, execute: false })
    expect(() => parseRetirementArgs([
      '--initialize-mutation-journal',
      '--reconcile-from-journal',
      `--confirm=${SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL}`,
    ])).toThrow(/isolated read-only-chain mode|isolated local-state operation/)
  })

  it('reasserts pause and retires the cap in one PTB', () => {
    const tx = buildLegacyRetirementTransaction({
      callablePackageId: CALLABLE,
      legacyConfigId: SOULIDITY_MAINNET_LEGACY_CONFIG,
      legacyAdminCapId: SOULIDITY_MAINNET_LEGACY_ADMIN_CAP,
    })
    const data = JSON.parse(JSON.stringify(tx.getData()))
    expect(data.commands).toHaveLength(2)
    expect(data.commands[0].MoveCall.function).toBe('update_paused')
    expect(data.commands[1].MoveCall.function).toBe('retire_legacy_market')
    expect(JSON.stringify(data.commands)).toContain(CALLABLE.slice(2))
  })

  it('extracts exactly one successor config and admin cap by defining package', () => {
    expect(extractRetirementObjectIds({
      objectChanges: [
        {
          type: 'created',
          objectType: `${CALLABLE}::market::MarketConfigV2`,
          objectId: CONFIG_V2,
        },
        {
          type: 'created',
          objectType: `${CALLABLE}::market::MarketConfigV6`,
          objectId: CONFIG_V6,
        },
        { type: 'created', objectType: `${CALLABLE}::market::MarketAdminCapV6`, objectId: ADMIN_V6 },
      ],
      events: [
        { type: `${CALLABLE}::market::LegacyMarketRetired`, parsedJson: {
          config_v2_id: CONFIG_V2, admin_cap_v2_id: ADMIN_V2,
        } },
        { type: `${CALLABLE}::market::MarketV6Initialized`, parsedJson: {
          config_v2_id: CONFIG_V2, admin_cap_v2_id: ADMIN_V2,
          config_v6_id: CONFIG_V6, admin_cap_v6_id: ADMIN_V6,
        } },
      ],
    }, CALLABLE, CALLABLE)).toEqual({
      marketConfigV2Id: CONFIG_V2,
      marketAdminCapV2Id: ADMIN_V2,
      marketConfigV6Id: CONFIG_V6,
      marketAdminCapV6Id: ADMIN_V6,
    })
    expect(() => extractRetirementObjectIds({
      objectChanges: [],
    }, CALLABLE, CALLABLE)).toThrow(/exactly one/)
  })
})

describe('fresh-family market gates', () => {
  it('publishes paused and retires with both v2 gates disabled', () => {
    const market = readFileSync(
      join(process.cwd(), 'move/soulidity/sources/market.move'),
      'utf8',
    )
    const retirement = market.slice(
      market.indexOf('public fun retire_legacy_market('),
      market.indexOf('public fun update_config_v2_primary_enabled('),
    )
    const initializer = market.slice(
      market.indexOf('fun init_impl('),
      market.indexOf('#[test_only]\npublic fun init_for_testing'),
    )

    expect(market).toContain(
      'init_impl(package::claim(otw, ctx), ctx.sender(), true, ctx)',
    )
    expect(initializer).toContain('paused: start_paused')
    expect(retirement).toContain('primary_enabled: false')
    expect(retirement).toContain('secondary_enabled: false')
  })
})

describe('postflight proof parsing', () => {
  it('accepts only an EMarketPaused MoveAbort', () => {
    expect(assertLegacyPauseAbort({
      effects: {
        status: {
          status: 'failure',
          error: 'MoveAbort in 0xabc::market::init_personal_kiosk, abort code: 11',
        },
      },
    })).toContain('abort code: 11')
    expect(() => assertLegacyPauseAbort({
      effects: { status: { status: 'success' } },
    })).toThrow(/unexpectedly succeeded/)
    expect(() => assertLegacyPauseAbort({
      effects: {
        status: {
          status: 'failure',
          error: 'MoveAbort in 0xabc::market, abort code: 12',
        },
      },
    })).toThrow(/EMarketPaused/)
  })
})

describe('durable mainnet mutation journal', () => {
  const temporaryDirectories: string[] = []

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function journalPath() {
    const directory = mkdtempSync(join(tmpdir(), 'soulidity-mutation-journal-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'attempt.json')
    writeFileSync(path, 'null\n')
    return path
  }

  function upgradeCapObject(packageId: string) {
    return {
      data: {
        objectId: SOULIDITY_MAINNET_UPGRADE_CAP,
        type: '0x2::package::UpgradeCap',
        owner: { AddressOwner: SOULIDITY_MAINNET_ADMIN },
        content: {
          dataType: 'moveObject',
          type: '0x2::package::UpgradeCap',
          fields: { package: packageId, policy: 0, version: '2' },
        },
      },
    }
  }

  it('refuses missing state until explicit initialization creates private operator state', () => {
    const directory = mkdtempSync(join(tmpdir(), 'soulidity-private-journal-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'operator-state', 'attempt.json')

    expect(() => readMainnetMutationAttempt(path)).toThrow(/journal is missing/)
    expect(() => assertNoPendingMainnetMutationAttempt(path)).toThrow(/journal is missing/)
    initializeMainnetMutationJournal(
      SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL,
      path,
    )
    expect(readMainnetMutationAttempt(path)).toBeNull()
    expect(statSync(join(directory, 'operator-state')).mode & 0o777).toBe(0o700)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(SOULIDITY_MAINNET_MUTATION_ATTEMPT_PATH).toContain(
      '/.soulidity-state/mainnet-mutation-attempt.json',
    )
    expect(SOULIDITY_MAINNET_MUTATION_ATTEMPT_PATH).not.toContain('/packages/')
    expect(SOULIDITY_MAINNET_MUTATION_ATTEMPT_PATH).not.toContain('/web/')
    expect(() => initializeMainnetMutationJournal(
      SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL,
      path,
    )).toThrow(/already exists/)
  })

  it('does not chmod an existing custom parent directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'soulidity-custom-parent-'))
    temporaryDirectories.push(directory)
    chmodSync(directory, 0o755)
    const path = join(directory, 'attempt.json')

    initializeMainnetMutationJournal(
      SOULIDITY_MAINNET_CONFIRM_INITIALIZE_JOURNAL,
      path,
    )
    expect(statSync(directory).mode & 0o777).toBe(0o755)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('blocks retries until the same verified journal is cleared', () => {
    const path = journalPath()
    const prepared = beginMainnetMutationAttempt({
      operation: 'upgrade',
      signerAddress: SOULIDITY_MAINNET_ADMIN,
      digest: JOURNAL_DIGEST,
      transactionBytesBase64: JOURNAL_BYTES_BASE64,
      signature: JOURNAL_SIGNATURE,
      context: { expected: CALLABLE },
    }, path)
    expect(readMainnetMutationAttempt(path)).toMatchObject({
      status: 'prepared',
      digest: JOURNAL_DIGEST,
    })
    expect(() => assertNoPendingMainnetMutationAttempt(path)).toThrow(/DO NOT RETRY/)
    const submitted = updateMainnetMutationAttempt(prepared, 'submitted', path)
    expect(() => clearMainnetMutationAttempt(submitted, path)).toThrow(/verified matching/)
    const verified = updateMainnetMutationAttempt(submitted, 'verified', path)
    clearMainnetMutationAttempt(verified, path)
    expect(readMainnetMutationAttempt(path)).toBeNull()
  })

  it('keeps both upgrade and retirement journals when the digest is not visible yet', async () => {
    const invisibleClient = {
      getChainIdentifier: async () => SOULIDITY_MAINNET_CHAIN_IDENTIFIER,
      getTransactionBlock: async () => {
        throw new Error('transaction not found')
      },
    }
    const upgradePath = journalPath()
    const upgrade = beginMainnetMutationAttempt({
      operation: 'upgrade',
      signerAddress: SOULIDITY_MAINNET_ADMIN,
      digest: JOURNAL_DIGEST,
      transactionBytesBase64: JOURNAL_BYTES_BASE64,
      signature: JOURNAL_SIGNATURE,
      context: {
        originalPackageId: SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
        currentPackageId: SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
        expectedCallablePackageId: CALLABLE,
        upgradeCapId: SOULIDITY_MAINNET_UPGRADE_CAP,
        legacyConfigId: SOULIDITY_MAINNET_LEGACY_CONFIG,
        legacyAdminCapId: SOULIDITY_MAINNET_LEGACY_ADMIN_CAP,
        previousUpgradeVersion: '1',
        nextUpgradeVersion: '2',
        writeManifest: false,
        toolchainVersion: '1.76.1',
        priorManifestSha256: 'prior',
        priorPublishedTomlSha256: 'prior',
      },
    }, upgradePath)
    await expect(reconcileUpgradeFromJournal({
      client: invisibleClient as never,
      attempt: upgrade,
      journalPath: upgradePath,
    })).rejects.toThrow(/transaction not found/)
    expect(readMainnetMutationAttempt(upgradePath)).toMatchObject({ status: 'prepared' })

    const retirementPath = journalPath()
    const retirement = beginMainnetMutationAttempt({
      operation: 'retire-legacy-market',
      signerAddress: SOULIDITY_MAINNET_ADMIN,
      digest: JOURNAL_DIGEST,
      transactionBytesBase64: JOURNAL_BYTES_BASE64,
      signature: JOURNAL_SIGNATURE,
      context: {
        originalPackageId: SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
        callablePackageId: CALLABLE,
        upgradeCapId: SOULIDITY_MAINNET_UPGRADE_CAP,
        legacyConfigId: SOULIDITY_MAINNET_LEGACY_CONFIG,
        legacyAdminCapId: SOULIDITY_MAINNET_LEGACY_ADMIN_CAP,
        marketConfigV2PackageId: CALLABLE,
        marketConfigV6PackageId: CALLABLE,
        animacraftProvenancePackageId: SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
        simulatedMarketConfigV2Id: CONFIG_V2,
        simulatedMarketAdminCapV2Id: ADMIN_V2,
        simulatedMarketConfigV6Id: CONFIG_V6,
        simulatedMarketAdminCapV6Id: ADMIN_V6,
        writeManifest: false,
        priorManifestSha256: 'prior',
      },
    }, retirementPath)
    await expect(reconcileMarketMutationFromJournal({
      client: invisibleClient as never,
      attempt: retirement,
      journalPath: retirementPath,
    })).rejects.toThrow(/transaction not found/)
    expect(readMainnetMutationAttempt(retirementPath)).toMatchObject({ status: 'prepared' })
  })

  it('reconciles an upgrade by digest with reads only and clears the journal last', async () => {
    const path = journalPath()
    const attempt = beginMainnetMutationAttempt({
      operation: 'upgrade',
      signerAddress: SOULIDITY_MAINNET_ADMIN,
      digest: JOURNAL_DIGEST,
      transactionBytesBase64: JOURNAL_BYTES_BASE64,
      signature: JOURNAL_SIGNATURE,
      context: {
        originalPackageId: SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
        currentPackageId: SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
        expectedCallablePackageId: CALLABLE,
        upgradeCapId: SOULIDITY_MAINNET_UPGRADE_CAP,
        legacyConfigId: SOULIDITY_MAINNET_LEGACY_CONFIG,
        legacyAdminCapId: SOULIDITY_MAINNET_LEGACY_ADMIN_CAP,
        previousUpgradeVersion: '1',
        nextUpgradeVersion: '2',
        writeManifest: true,
        toolchainVersion: '1.76.1',
        priorManifestSha256: 'prior-manifest',
        priorPublishedTomlSha256: 'prior-published',
      },
    }, path)
    const client = {
      getChainIdentifier: async () => SOULIDITY_MAINNET_CHAIN_IDENTIFIER,
      getTransactionBlock: async () => ({
        digest: JOURNAL_DIGEST,
        effects: { status: { status: 'success' } },
        objectChanges: [{ type: 'published', packageId: CALLABLE }],
      }),
      getObject: async () => upgradeCapObject(CALLABLE),
    }
    await expect(reconcileUpgradeFromJournal({
      client: client as never,
      attempt,
      journalPath: path,
      persistRecords: () => {
        throw new Error('simulated manifest write failure')
      },
    })).rejects.toThrow(/simulated manifest write failure/)
    expect(readMainnetMutationAttempt(path)).toMatchObject({ status: 'verified' })

    await expect(reconcileUpgradeFromJournal({
      client: client as never,
      attempt,
      journalPath: path,
      persistRecords: () => undefined,
    })).resolves.toEqual({
      digest: JOURNAL_DIGEST,
      callablePackageId: CALLABLE,
      version: '2',
    })
    expect(readMainnetMutationAttempt(path)).toBeNull()
    expect('executeTransactionBlock' in client).toBe(false)
  })

  it('reconciles a retirement by digest and proves deleted legacy/admin successor state', async () => {
    const path = journalPath()
    const attempt = beginMainnetMutationAttempt({
      operation: 'retire-legacy-market',
      signerAddress: SOULIDITY_MAINNET_ADMIN,
      digest: JOURNAL_DIGEST,
      transactionBytesBase64: JOURNAL_BYTES_BASE64,
      signature: JOURNAL_SIGNATURE,
      context: {
        originalPackageId: SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
        callablePackageId: CALLABLE,
        upgradeCapId: SOULIDITY_MAINNET_UPGRADE_CAP,
        legacyConfigId: SOULIDITY_MAINNET_LEGACY_CONFIG,
        legacyAdminCapId: SOULIDITY_MAINNET_LEGACY_ADMIN_CAP,
        marketConfigV2PackageId: CALLABLE,
        marketConfigV6PackageId: CALLABLE,
        animacraftProvenancePackageId: SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
        simulatedMarketConfigV2Id: CONFIG_V2,
        simulatedMarketAdminCapV2Id: ADMIN_V2,
        simulatedMarketConfigV6Id: CONFIG_V6,
        simulatedMarketAdminCapV6Id: ADMIN_V6,
        writeManifest: true,
        priorManifestSha256: 'prior-manifest',
      },
    }, path)
    const objects: Record<string, unknown> = {
      [SOULIDITY_MAINNET_UPGRADE_CAP]: upgradeCapObject(CALLABLE),
      [SOULIDITY_MAINNET_LEGACY_CONFIG]: {
        data: {
          objectId: SOULIDITY_MAINNET_LEGACY_CONFIG,
          type: `${SOULIDITY_MAINNET_ORIGINAL_PACKAGE}::market::MarketConfig`,
          owner: { Shared: { initial_shared_version: '1' } },
          content: {
            dataType: 'moveObject',
            type: `${SOULIDITY_MAINNET_ORIGINAL_PACKAGE}::market::MarketConfig`,
            fields: {
              paused: true,
              fee_recipient: SOULIDITY_MAINNET_ADMIN,
              platform_fee_bps: 1000,
            },
          },
        },
      },
      [SOULIDITY_MAINNET_LEGACY_ADMIN_CAP]: {
        data: null,
        error: { code: 'deleted' },
      },
      [CONFIG_V2]: {
        data: {
          objectId: CONFIG_V2,
          type: `${CALLABLE}::market::MarketConfigV2`,
          owner: { Shared: { initial_shared_version: '1' } },
          content: {
            dataType: 'moveObject',
            type: `${CALLABLE}::market::MarketConfigV2`,
            fields: {
              legacy_config_id: SOULIDITY_MAINNET_LEGACY_CONFIG,
              version: '2',
              primary_enabled: false,
              secondary_enabled: false,
              fee_recipient: SOULIDITY_MAINNET_ADMIN,
              platform_fee_bps: 1000,
            },
          },
        },
      },
      [CONFIG_V6]: {
        data: {
          objectId: CONFIG_V6,
          type: `${CALLABLE}::market::MarketConfigV6`,
          owner: { Shared: { initial_shared_version: '1' } },
          content: {
            dataType: 'moveObject',
            type: `${CALLABLE}::market::MarketConfigV6`,
            fields: {
              version: '6',
              config_v2_id: CONFIG_V2,
              legacy_config_id: SOULIDITY_MAINNET_LEGACY_CONFIG,
              fee_recipient: SOULIDITY_MAINNET_ADMIN,
              platform_fee_bps: 1000,
              secondary_enabled: false,
            },
          },
        },
      },
      [ADMIN_V6]: {
        data: {
          objectId: ADMIN_V6,
          type: `${CALLABLE}::market::MarketAdminCapV6`,
          owner: { AddressOwner: SOULIDITY_MAINNET_ADMIN },
          content: {
            dataType: 'moveObject',
            type: `${CALLABLE}::market::MarketAdminCapV6`,
            fields: {
              config_v2_id: CONFIG_V2,
              config_v6_id: CONFIG_V6,
              v2_admin_cap: { fields: { id: { id: ADMIN_V2 }, config_id: CONFIG_V2 } },
            },
          },
        },
      },
    }
    const requestedObjectIds: string[] = []
    const client = {
      getChainIdentifier: async () => SOULIDITY_MAINNET_CHAIN_IDENTIFIER,
      getTransactionBlock: async () => ({
        digest: JOURNAL_DIGEST,
        effects: { status: { status: 'success' } },
        objectChanges: [
          {
            type: 'created',
            objectType: `${CALLABLE}::market::MarketConfigV2`,
            objectId: CONFIG_V2,
          },
          {
            type: 'created',
            objectType: `${CALLABLE}::market::MarketConfigV6`,
            objectId: CONFIG_V6,
          },
          { type: 'created', objectType: `${CALLABLE}::market::MarketAdminCapV6`, objectId: ADMIN_V6 },
        ],
        events: [
          { type: `${CALLABLE}::market::LegacyMarketRetired`, parsedJson: {
            legacy_config_id: SOULIDITY_MAINNET_LEGACY_CONFIG,
            config_v2_id: CONFIG_V2,
            admin_cap_v2_id: ADMIN_V2,
            retired_by: SOULIDITY_MAINNET_ADMIN,
          } },
          { type: `${CALLABLE}::market::MarketV6Initialized`, parsedJson: {
            config_v2_id: CONFIG_V2,
            admin_cap_v2_id: ADMIN_V2,
            config_v6_id: CONFIG_V6,
            admin_cap_v6_id: ADMIN_V6,
            initialized_by: SOULIDITY_MAINNET_ADMIN,
          } },
        ],
      }),
      getObject: async ({ id }: { id: string }) => {
        requestedObjectIds.push(id)
        return objects[id]
      },
    }
    await expect(reconcileMarketMutationFromJournal({
      client: client as never,
      attempt,
      journalPath: path,
      persistRecords: () => {
        throw new Error('simulated retirement manifest write failure')
      },
    })).rejects.toThrow(/simulated retirement manifest write failure/)
    expect(readMainnetMutationAttempt(path)).toMatchObject({ status: 'verified' })

    await expect(reconcileMarketMutationFromJournal({
      client: client as never,
      attempt,
      journalPath: path,
      persistRecords: () => undefined,
    })).resolves.toEqual({
      digest: JOURNAL_DIGEST,
      operation: 'retire-legacy-market',
      ids: {
        marketConfigV2Id: CONFIG_V2,
        marketAdminCapV2Id: ADMIN_V2,
        marketConfigV6Id: CONFIG_V6,
        marketAdminCapV6Id: ADMIN_V6,
      },
    })
    expect(readMainnetMutationAttempt(path)).toBeNull()
    expect('executeTransactionBlock' in client).toBe(false)
    expect(requestedObjectIds).not.toContain(ADMIN_V2)
  })

  it('builds, hashes and signs one exact byte array before journaled submission', () => {
    for (const relativePath of [
      'scripts/upgrade-soulidity-mainnet.ts',
      'scripts/retire-soulidity-legacy-market.ts',
    ]) {
      const source = readFileSync(join(process.cwd(), relativePath), 'utf8')
      const pendingGuard = source.indexOf('assertNoPendingMainnetMutationAttempt()')
      const keyLoad = source.indexOf('loadKeypairFromEnv(args.privKeyEnv)')
      const build = source.indexOf('await tx.build({ client })')
      const digest = source.indexOf('TransactionDataBuilder.getDigestFromBytes', build)
      const sign = source.indexOf('signer.signTransaction', digest)
      const journal = source.indexOf('beginMainnetMutationAttempt', sign)
      const submit = source.indexOf('client.executeTransactionBlock', journal)
      expect(pendingGuard).toBeGreaterThan(-1)
      expect(keyLoad).toBeGreaterThan(pendingGuard)
      expect(build).toBeGreaterThan(pendingGuard)
      expect(digest).toBeGreaterThan(build)
      expect(sign).toBeGreaterThan(digest)
      expect(journal).toBeGreaterThan(sign)
      expect(submit).toBeGreaterThan(journal)
      expect(source).not.toContain('client.signAndExecuteTransaction')
      expect(source).toContain('submittedMainnetMutationError')
    }
    const sharedSafety = readFileSync(
      join(process.cwd(), 'scripts/lib/soulidity-mainnet-migration.ts'),
      'utf8',
    )
    expect(sharedSafety).toContain('DO NOT RETRY')
  })
})

describe('canonical deployment and atomic manifest patching', () => {
  const temporaryDirectories: string[] = []

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects a manifest that redirects any canonical governance object', () => {
    expect(() => assertCanonicalMainnetDeployment({
      originalPackageId: SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
      callablePackageId: SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
      packageId: SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
      marketConfigId: SOULIDITY_MAINNET_LEGACY_CONFIG,
      marketAdminCapId: SOULIDITY_MAINNET_LEGACY_ADMIN_CAP,
      upgradeCapId: `0x${'f'.repeat(64)}`,
    })).toThrow(/non-canonical mainnet UpgradeCap/)
  })

  it('patches fields without replacing the record and rejects concurrent writes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'soulidity-migration-test-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'manifest.json')
    const initial = {
      testnet: { packageId: '0xtestnet' },
      mainnet: {
        packageId: SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
        originalPackageId: SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
        callablePackageId: SOULIDITY_MAINNET_ORIGINAL_PACKAGE,
        keepMe: 'unchanged',
      },
    }
    writeFileSync(path, `${JSON.stringify(initial, null, 2)}\n`)
    const snapshot = readDeploymentSnapshot(path)
    atomicPatchMainnetDeployment(snapshot, {
      callablePackageId: CALLABLE,
      marketConfigV2Id: CONFIG_V2,
    })
    const after = JSON.parse(readFileSync(path, 'utf8'))
    expect(after.mainnet.keepMe).toBe('unchanged')
    expect(after.mainnet.callablePackageId).toBe(CALLABLE)
    expect(after.testnet.packageId).toBe('0xtestnet')

    expect(() => atomicPatchMainnetDeployment(snapshot, {
      marketAdminCapV2Id: ADMIN_V2,
    })).toThrow(/changed during the chain operation/)
  })

  it('never treats confirmation as optional', () => {
    expect(() => assertExecutionConfirmation(true, null, 'CONFIRM')).toThrow(
      /no transaction was signed/,
    )
    expect(() => assertExecutionConfirmation(false, null, 'CONFIRM')).not.toThrow()
  })
})
