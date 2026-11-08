import { normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { readPinnedMovePackage } from '../sui/pinned-move-package'
import { EconomicsConfigBcs, recoverEconomicsHistoricalGates } from './commerce/economics-bcs'
import { parseNativeCreationIntent, type NativeCreationIntent } from './native-creation-transaction'
import { parseCanonicalNativeWorkbenchTarget, type CanonicalNativeWorkbenchTarget } from './canonical-native-workbench'
import { bcs } from '@mysten/sui/bcs'

/** Historical Config body + exact Native-linked Foundation package identity.
 * Four possible committed gates are recovered from original Config bytes.
 * No live dynamic-field lookup. SourceRevision/Registry slots and the actual
 * Native catalog are NOT implied by their embedded snapshots; parent must
 * prove those or qualify the exact executed modules' assertions separately.
 * No receipt, current authority or signing capability is returned. */
export async function readNativeMintConfigPolicy(input: {
  client: SuiGrpcClient; effects: ReturnType<typeof bcs.TransactionEffects.parse>; transactionDigest: string
  intent: NativeCreationIntent; target: CanonicalNativeWorkbenchTarget; signal: AbortSignal
}) {
  const intent = parseNativeCreationIntent(input.intent), target = parseCanonicalNativeWorkbenchTarget(input.target)
  const effects = structuredClone(input.effects), transactionDigest = input.transactionDigest, { client } = input
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  function check(v: unknown, code: string): asserts v { if (!v) throw Error(`NATIVE_CONFIG_POLICY_${code}`) }
  const id = (s: string) => /^0x[0-9a-f]{64}$/.test(s) && BigInt(s) !== 0n
  check(target.configId === intent.target.configId && target.native.callablePackageId === intent.target.nativeCallablePackageId, 'TARGET')
  const e = effects.V2, rows = e?.unchangedConsensusObjects.filter(([id]) => id === target.configId)
  check(e?.transactionDigest === transactionDigest && rows?.length === 1 && rows[0][1].ReadOnlyRoot, 'CONFIG_REFERENCE')
  const version = BigInt(rows[0][1].ReadOnlyRoot[0])
  const observed = (await client.ledgerService.getObject({ objectId: target.configId, version,
    readMask: { paths: ['object_type'] } }, { abort: signal })).response.object?.objectType
  check(typeof observed === 'string' && /^0x[0-9a-f]{64}::economics::Config</.test(observed), 'CONFIG_TYPE')
  const object = await readHistoricalMoveObject({ client, effects, transactionDigest, objectId: target.configId,
    type: normalizeStructTag(observed), mode: 'readonly', signal, maxBytes: 256 * 1024 })
  const config = EconomicsConfigBcs.parse(object.bytes)
  check(toBase64(EconomicsConfigBcs.serialize(config).toBytes()) === toBase64(object.bytes), 'CONFIG_CANONICAL')
  check(id(config.original_package) && id(config.callable_package), 'FOUNDATION_ID')
  const native = await readPinnedMovePackage(client, target.native, signal), link = native.linkage.get(config.original_package)
  check(link?.upgradedId === config.callable_package, 'FOUNDATION_LINK')
  // Storage IDs identify immutable packages. The Native package itself fixes
  // the allowed Foundation ID/version; its fetched digest is verified from full
  // package BCS, never promoted from an unverified metadata projection.
  const row = (await client.ledgerService.getObject({ objectId: config.callable_package,
    readMask: { paths: ['digest'] } }, { abort: signal })).response.object
  check(row?.digest, 'FOUNDATION_PACKAGE')
  const foundation = await readPinnedMovePackage(client, { originalPackageId: config.original_package,
    callablePackageId: config.callable_package, callableDigest: row.digest }, signal)
  check(link.upgradedVersion === String(foundation.version), 'FOUNDATION_VERSION')
  const origins = foundation.origins, origin = origins.get('economics::Config')
  check(origin && origins.get('economics::Authority') === config.original_package
    && origins.get('economics::ProtocolRevision2') === config.callable_package
    && normalizeStructTag(observed) === `${origin}::economics::Config<${normalizeStructTag(intent.target.paymentCoinType)}>`, 'FOUNDATION_ORIGIN')
  check(config.id === target.configId && config.schema === 3 && config.income.root === config.id
    && normalizeStructTag(config.payment_coin.name) === normalizeStructTag(intent.target.paymentCoinType)
    && config.enabled && !config.paused && BigInt(config.minimum_release) <= 2n
    && config.primary_bps <= 10000 && config.secondary_bps <= 10000 && id(config.recipient)
    && config.roles.roles.length === 6 && id(config.income.requests.id) && config.income.requests.id !== config.id
    && BigInt(config.income.collected) >= BigInt(config.income.withdrawn)
    && BigInt(config.income.collected) - BigInt(config.income.withdrawn) === BigInt(config.income.funds), 'CONFIG_BINDING')
  const gates = recoverEconomicsHistoricalGates(config)
  check(gates.gates.primary, 'PRIMARY_DISABLED')
  check(config.native_binding && id(config.native_binding.catalog) && config.native_binding.commitment.length === 32
    && config.native_binding.commitment.some(b => b !== 0), 'NATIVE_BINDING')
  const role = config.roles.roles[0]
  check(role.pinned && role.original === config.native_binding.original_package && role.callable === config.native_binding.callable_package
    && id(role.original) && id(role.callable), 'NATIVE_ROLE_BINDING')
  check(intent.royaltyBps + config.secondary_bps <= 10000, 'ROYALTY_BOUND')
  signal.throwIfAborted()
  return { proof: 'historical-native-config-policy-body-only' as const, transactionDigest, foundation: foundation.pin,
    foundationVersion: String(foundation.version), configRevision: config.revision, commitment: toBase64(config.commitment),
    gates: gates.gates, secondaryBps: config.secondary_bps, requiresSourceSlotsAndCatalogProof: true as const, requiresExecutedPackageQualification: true as const,
    notCreationReceipt: true as const, notCurrentAuthority: true as const }
}
