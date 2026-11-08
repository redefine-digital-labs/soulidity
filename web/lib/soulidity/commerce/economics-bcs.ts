import { bcs } from '@mysten/sui/bcs'
import { sha256 } from '@noble/hashes/sha2.js'
import { toHex } from '@mysten/sui/utils'

const A = bcs.Address, U = bcs.u64(), V = bcs.byteVector()
const T = bcs.struct('TypeName', { name: bcs.string() })
const Table = bcs.struct('Table', { id: A, size: U })
const Role = bcs.struct('Role', { original: A, callable: A, marker: bcs.option(T), version: U,
  pinned: bcs.bool(), frozen: bcs.bool() })
const NativeBinding = bcs.struct('NativeBindingSnapshot', { catalog: A, generation: U, original_package: A,
  callable_package: A, commitment: V })
const ReleaseBinding = bcs.struct('ReleaseBindingSnapshot', { catalog: A, generation: U, original_package: A,
  callable_package: A, marker: T, commitment: V })
const Roles = bcs.struct('State', { roles: bcs.vector(Role) })
export const EconomicsMarketGatesBcs = bcs.struct('MarketGates', { primary: bcs.bool(), secondary: bcs.bool() })
export const EconomicsConfigSnapshotBcs = bcs.struct('ConfigSnapshot', { domain: V, schema: bcs.u16(), config: A, revision: U,
  enabled: bcs.bool(), paused: bcs.bool(), payment_coin: T, original_package: A, callable_package: A, income_root: A,
  primary_bps: bcs.u16(), secondary_bps: bcs.u16(), complete_fee: U, recipient: A,
  native_binding: bcs.option(NativeBinding), release_binding: bcs.option(ReleaseBinding), minimum_release: U, roles: Roles })
export const EconomicsOperationalSnapshotBcs = bcs.struct('OperationalSnapshot', { domain: V, config: EconomicsConfigSnapshotBcs, gates: EconomicsMarketGatesBcs })
export const IncomeLedgerBcs = bcs.struct('Ledger', { root: A, revision: U, funds: U, collected: bcs.u128(),
  withdrawn: bcs.u128(), requests: Table })
export const EconomicsConfigBcs = bcs.struct('Config', { id: A, revision: U, primary_bps: bcs.u16(), secondary_bps: bcs.u16(),
  complete_fee: U, recipient: A, paused: bcs.bool(), income: IncomeLedgerBcs, schema: bcs.u16(), enabled: bcs.bool(),
  payment_coin: T, original_package: A, callable_package: A, commitment: V, native_binding: bcs.option(NativeBinding),
  release_binding: bcs.option(ReleaseBinding), minimum_release: U, roles: Roles })
export const EconomicsAdminBcs = bcs.struct('Admin', { id: A, config: A })
export const IncomeRequestBcs = bcs.struct('Request', { actor: A, attempt: V })
export const IncomeReceiptBcs = bcs.struct('Receipt', { root: A, actor: A, attempt: V, recipient: A, amount: U,
  before_revision: U, after_revision: U, balance: U, total_collected: bcs.u128(), total_withdrawn: bcs.u128() })
export const IncomeReceiptFieldBcs = bcs.struct('Field', { id: A, name: IncomeRequestBcs, value: IncomeReceiptBcs })
export const NativeOfferBcs = bcs.struct('Offer', { id: A, root: A, state: A, registry: A, config: A, config_revision: U,
  policy: A, seller: A, kiosk: A, creator: A, royalty: bcs.u16(), generation: U, root_revision: U,
  manifest: V, collection: bcs.option(A), ask: U, active: bcs.bool(),
  purchase: bcs.option(bcs.struct('PurchaseCap', { id: A, kiosk_id: A, item_id: A, min_price: U })) })

const configDomain = new TextEncoder().encode('soulidity-protocol-config-v3')
const operationalDomain = new TextEncoder().encode('soulidity-protocol-operational-v4')

/** Pure exact economics::snapshot. Ledger balances/revision/requests are not
 * in this policy commitment; only income.root is. Caller authenticates the
 * original full Config bytes/ObjectRef, never today's mutable Config.
 */
export function economicsConfigSnapshot(c: ReturnType<typeof EconomicsConfigBcs.parse>) {
  return EconomicsConfigSnapshotBcs.parse(EconomicsConfigSnapshotBcs.serialize({ domain: configDomain, schema: c.schema,
    config: c.id, revision: c.revision, enabled: c.enabled, paused: c.paused, payment_coin: c.payment_coin,
    original_package: c.original_package, callable_package: c.callable_package, income_root: c.income.root,
    primary_bps: c.primary_bps, secondary_bps: c.secondary_bps, complete_fee: c.complete_fee, recipient: c.recipient,
    native_binding: c.native_binding, release_binding: c.release_binding, minimum_release: c.minimum_release, roles: c.roles }).toBytes())
}
export function economicsOperationalSnapshotHash(value: ReturnType<typeof EconomicsOperationalSnapshotBcs.parse>) {
  if (toHex(value.domain) !== toHex(operationalDomain) || toHex(value.config.domain) !== toHex(configDomain)) {
    throw Error('ECONOMICS_OPERATIONAL_DOMAIN_MISMATCH')
  }
  return sha256(EconomicsOperationalSnapshotBcs.serialize(value).toBytes())
}
/** Recover the two committed booleans from the ORIGINAL Config snapshot. No
 * live DF lookup, RPC, signing or old-ABI replay. Exactly one of all four
 * combinations must match; legacy commitments do not imply false gates.
 */
export function recoverEconomicsHistoricalGates(c: ReturnType<typeof EconomicsConfigBcs.parse>) {
  if (c.schema !== 3 || c.id !== c.income.root || c.commitment.length !== 32) throw Error('ECONOMICS_HISTORICAL_CONFIG_BINDING')
  const config = economicsConfigSnapshot(c), matches = []
  for (const primary of [false, true]) for (const secondary of [false, true]) {
    const snapshot = { domain: operationalDomain, config, gates: { primary, secondary } }
    const hash = economicsOperationalSnapshotHash(snapshot)
    if (toHex(hash) === toHex(c.commitment)) matches.push({ gates: { primary, secondary }, snapshot, commitment: hash })
  }
  if (matches.length !== 1) {
    const legacy = sha256(EconomicsConfigSnapshotBcs.serialize(config).toBytes())
    throw Error(toHex(legacy) === toHex(c.commitment) ? 'ECONOMICS_LEGACY_GATES_UNAVAILABLE' : 'ECONOMICS_OPERATIONAL_COMMITMENT_MISMATCH')
  }
  return { proof: 'original-config-committed-gates-only' as const, ...matches[0], notCurrentAuthority: true as const }
}
