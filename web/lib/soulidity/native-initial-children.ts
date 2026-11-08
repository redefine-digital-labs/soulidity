import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../sui/move-empty-struct'
import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { parseNativeCreationIntent, type NativeCreationIntent } from './native-creation-transaction'

const A = bcs.Address, U = bcs.u64(), V = bcs.byteVector(), S = bcs.string()
const Controller = bcs.struct('Controller', { operator: bcs.struct('TypeName', { name: S }), parent: A, root: A })
const Table = bcs.struct('Table', { id: A, size: U })
export const NativeInitialAuthorizationBcs = bcs.struct('Authorization', { id: A, controller: Controller, root: A,
  generation: U, capacity: U, count: U, next_sequence: U, grants: Table })
export const NativeInitialPaidBcs = bcs.struct('Ledger', { id: A, controller: Controller, root: A, protocol: A,
  revision: U, offers: Table, entries: Table, attempts: Table })
export const NativeInitialConfigurationBcs = bcs.struct('Configuration', { id: A, controller: Controller, root: A,
  revision: U, values: Table, entries: bcs.vector(bcs.struct('Entry', { key: S, value_hash: V })) })
const Subcommitment = bcs.struct('Subcommitment', { domain: V, value: V })
/** Field names do not affect BCS; these reproduce the source-owned nested
 * Library and Configuration commitments, then the Native State commitment. */
export function nativeInitialSemanticCommitment(input: {
  state: Uint8Array; library: Uint8Array; authorization: Uint8Array; paid: Uint8Array; configuration: Uint8Array
}) {
  const enc = (value: string) => new TextEncoder().encode(value)
  const sub = (domain: string, value: Uint8Array) => sha256(Subcommitment.serialize({ domain: enc(domain), value }).toBytes())
  return sha256(bcs.struct('Commitment', { domain: V, state: V, content: V, authorization: V, paid: V, configuration: V }).serialize({
    domain: enc('soulidity/native-state/v1'), state: input.state,
    content: sub('soulidity/founding-library/v1', input.library), authorization: input.authorization, paid: input.paid,
    configuration: sub('soulidity/state-configuration/v1', input.configuration) }).toBytes())
}

/** Original effects and full Object BCS only; this grants no current access.
 * The parent proves release linkage/finality and checks this semantic hash
 * against the descriptor committed by the original Root/Created manifest. */
export async function readNativeInitialChildren(input: {
  client: SuiGrpcClient; effects: ReturnType<typeof bcs.TransactionEffects.parse>; transactionDigest: string; signal: AbortSignal
  intent: NativeCreationIntent; rootId: string; stateId: string; authorizationId: string; paidId: string; configurationId: string
  nativeOrigins: Map<string, string>; contentOrigins: Map<string, string>; state: Uint8Array; library: Uint8Array
}) {
  input = { ...input, effects: structuredClone(input.effects), intent: parseNativeCreationIntent(input.intent),
    nativeOrigins: new Map(input.nativeOrigins), contentOrigins: new Map(input.contentOrigins),
    state: new Uint8Array(input.state), library: new Uint8Array(input.library) }
  const { client, effects, transactionDigest, signal } = input
  function check(v: unknown, code: string): asserts v { if (!v) throw Error(`NATIVE_CHILD_${code}`) }
  function type(map: Map<string, string>, module: string, name: string) {
    const origin = map.get(`${module}::${name}`); check(origin, 'TYPE_ORIGIN'); return `${origin}::${module}::${name}`
  }
  async function read(objectId: string, expectedType: string) {
    return readHistoricalMoveObject({ client, effects, transactionDigest, objectId, type: expectedType, mode: 'created', signal, maxBytes: 256 * 1024 })
  }
  async function child(keyName: string, childId: string, childType: string) {
    const keyType = type(input.nativeOrigins, 'birth', keyName), wrapper = `0x2::dynamic_object_field::Wrapper<${keyType}>`
    const fieldId = deriveDynamicFieldID(input.stateId, wrapper, moveEmptyStructBytes())
    const row = await read(fieldId, `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`)
    const codec = bcs.struct('Field', { id: A, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: A })
    const field = codec.parse(row.bytes)
    check(toHex(codec.serialize(field).toBytes()) === toHex(row.bytes) && field.id === fieldId && field.value === childId
      && row.object.owner.ObjectOwner === input.stateId, 'DOF_BINDING')
    const output = await read(childId, childType)
    check(output.object.owner.ObjectOwner === fieldId, 'CHILD_OWNER'); return output.bytes
  }
  const [authorization, paid, configuration] = await Promise.all([
    child('AuthorizationKey', input.authorizationId, type(input.contentOrigins, 'authorization', 'Authorization')),
    child('PaidKey', input.paidId, type(input.contentOrigins, 'paid_access', 'Ledger')),
    child('ConfigurationKey', input.configurationId, type(input.contentOrigins, 'state_configuration', 'Configuration')),
  ])
  const auth = NativeInitialAuthorizationBcs.parse(authorization), ledger = NativeInitialPaidBcs.parse(paid)
  const config = NativeInitialConfigurationBcs.parse(configuration)
  check(toHex(NativeInitialAuthorizationBcs.serialize(auth).toBytes()) === toHex(authorization)
    && toHex(NativeInitialPaidBcs.serialize(ledger).toBytes()) === toHex(paid)
    && toHex(NativeInitialConfigurationBcs.serialize(config).toBytes()) === toHex(configuration), 'NONCANONICAL')
  const operator = type(input.nativeOrigins, 'birth', 'ContentOperator')
  for (const [object, id] of [[auth, input.authorizationId], [ledger, input.paidId], [config, input.configurationId]] as const) {
    check(object.id === id && object.root === input.rootId && object.controller.parent === input.stateId
      && object.controller.root === input.rootId && normalizeStructTag(object.controller.operator.name) === operator, 'CONTROLLER')
  }
  check(auth.generation === '0' && auth.capacity === '1' && auth.count === '0' && auth.next_sequence === '0'
    && auth.grants.size === '0', 'AUTHORIZATION_INITIAL')
  check(ledger.protocol === input.intent.target.configId && ledger.revision === '0'
    && [ledger.offers, ledger.entries, ledger.attempts].every(t => t.size === '0'), 'PAID_INITIAL')
  const tables = [auth.grants.id, ledger.offers.id, ledger.entries.id, ledger.attempts.id, config.values.id]
  check(tables.every(id => /^0x[0-9a-f]{64}$/.test(id) && BigInt(id) !== 0n)
    && new Set([...tables, input.rootId, input.stateId, auth.id, ledger.id, config.id]).size === 10, 'TABLE_ALIAS')
  // birth::begin_verified applies keys in reverse: first duplicate wins,
  // while the entry vector keeps the first-seen reverse insertion order.
  const expected = new Map<string, number[]>()
  for (const entry of [...input.intent.configuration].reverse()) expected.set(entry.key, entry.value)
  check(config.revision === String(input.intent.configuration.length) && config.values.size === String(expected.size)
    && config.entries.length === expected.size, 'CONFIGURATION_COUNT')
  let index = 0
  for (const [key, value] of expected) {
    const entry = config.entries[index++]
    check(entry.key === key && toHex(entry.value_hash) === toHex(sha256(new Uint8Array(value))), 'CONFIGURATION_HASH')
    const fieldId = deriveDynamicFieldID(config.values.id, '0x1::string::String', S.serialize(key).toBytes())
    const output = await read(fieldId, '0x2::dynamic_field::Field<0x1::string::String,vector<u8>>')
    const codec = bcs.struct('Value', { id: A, name: S, value: V }), field = codec.parse(output.bytes)
    check(output.object.owner.ObjectOwner === config.values.id && field.id === fieldId && field.name === key
      && toHex(field.value) === toHex(new Uint8Array(value)) && toHex(codec.serialize(field).toBytes()) === toHex(output.bytes), 'CONFIGURATION_VALUE')
  }
  return { wrappedTableIds: tables, semantic: nativeInitialSemanticCommitment({ state: input.state, library: input.library, authorization, paid, configuration }),
    notCurrentAuthority: true as const }
}
