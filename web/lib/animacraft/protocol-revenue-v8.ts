import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import { CollectionCommandEventsBcs } from '../collections/collection-command-history'
import { collectionCommandRaw } from '../collections/collection-command-plan'
import { commerceId, decodeCommerce, readCommerceObject } from '../soulidity/commerce/economics-read'
import { assertAddressBalanceEffects } from '../sui/address-balance-effects'
import { readFinalizedMutation, type FinalizedMutationContext } from '../sui/finalized-mutation'
import { readSuiGasSettlement } from '../sui/gas-settlement'
import { historicalMoveObjectType, readHistoricalMoveObject } from '../sui/historical-object'
import { readPinnedMovePackage, type PinnedMovePackage } from '../sui/pinned-move-package'
import { MAINNET_GENESIS_DIGEST } from './mainnet-chain'
import { EquipmentMarketProtocolTreasuryBcs } from './native-equipment-market-bcs'
import { equipmentProtocolCommitment } from './native-equipment-source'
import { EquipmentProtocolBcs } from './native-equipment-source-bcs'

const MODULE = 'protocol_config_v8'
const WITHDRAW = 'withdraw_protocol_revenue_v8'
const EVENT = 'ProtocolRevenueV8Withdrawn'
const Admin = bcs.struct('ProtocolAdminCapV8', { id: bcs.Address, version: bcs.u64(), config_id: bcs.Address })
const Withdrawal = bcs.struct(EVENT, {
  config_id: bcs.Address, treasury_id: bcs.Address, operator: bcs.Address, recipient: bcs.Address, amount: bcs.u64(),
})
const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
const MAX_EPOCH = '18446744073709551615'
const SUI_TYPE = normalizeStructTag('0x2::sui::SUI')

export interface ProtocolRevenueTargetV8 {
  core: PinnedMovePackage
  configId: string
  coinType: string
}
interface RevenueRead {
  client: SuiGrpcClient
  target: ProtocolRevenueTargetV8
  signal: AbortSignal
}

function check(value: unknown, code: string): asserts value {
  if (!value) throw Error(`PROTOCOL_REVENUE_V8_${code}`)
}
function targetSnapshot(target: ProtocolRevenueTargetV8) {
  const snapshot = structuredClone(target)
  check(commerceId(snapshot.configId) && normalizeStructTag(snapshot.coinType) === snapshot.coinType, 'TARGET')
  return snapshot
}
async function readCore(client: SuiGrpcClient, target: ProtocolRevenueTargetV8, signal: AbortSignal) {
  const core = await readPinnedMovePackage(client, target.core, signal)
  const type = (name: string) => {
    const origin = core.origins.get(`${MODULE}::${name}`)
    check(origin === target.core.originalPackageId, 'CORE_TYPE_ORIGIN')
    return `${origin}::${MODULE}::${name}`
  }
  return {
    version: String(core.version), config: type('ProtocolConfigV8'), admin: type('ProtocolAdminCapV8'),
    treasury: `${type('ProtocolTreasuryV8')}<${target.coinType}>`, event: type(EVENT),
  }
}
function decodeConfig(bytes: Uint8Array, target: ProtocolRevenueTargetV8) {
  const config = decodeCommerce(EquipmentProtocolBcs, bytes)
  const commitment = equipmentProtocolCommitment(config)
  check(config.id === target.configId && config.version === '8'
    && config.core_original_package_id === target.core.originalPackageId
    && config.core_callable_package_id === target.core.callablePackageId
    && config.payment_coin_type === target.coinType
    && config.commitment.length === commitment.length
    && config.commitment.every((byte, index) => byte === commitment[index])
    && (config.treasury_id === null || (commerceId(config.treasury_id) && config.treasury_id !== config.id)),
  'CONFIG_BINDING')
  return config
}
function decodeTreasury(bytes: Uint8Array, objectId: string, configId: string) {
  const treasury = decodeCommerce(EquipmentMarketProtocolTreasuryBcs, bytes)
  const balance = BigInt(treasury.revenue.value), collected = BigInt(treasury.total_collected), withdrawn = BigInt(treasury.total_withdrawn)
  check(treasury.id === objectId && treasury.version === '8' && treasury.config_id === configId
    && collected - withdrawn === balance, 'TREASURY_BINDING')
  return { balance, collected, withdrawn }
}

type LiveObject = Awaited<ReturnType<typeof readCommerceObject>>
function sharedRef(object: LiveObject) {
  check(object.owner.Shared, 'SHARED_OWNER')
  return { objectId: object.objectId, version: object.version, digest: object.digest,
    initialSharedVersion: object.owner.Shared.initialSharedVersion }
}
function sameRef(first: LiveObject, last: LiveObject) {
  return first.version === last.version && first.digest === last.digest
}

/** Stable current shared state. An uninitialized Config has no balance. */
export async function readProtocolRevenueV8(input: RevenueRead) {
  const { client } = input, target = targetSnapshot(input.target)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(45000)])
  const { response } = await profileReadStep(signal, () => client.ledgerService.getServiceInfo({}, { abort: signal }))
  check(response.chainId === MAINNET_GENESIS_DIGEST, 'CHAIN')
  const types = await readCore(client, target, signal)
  const readConfig = () => readCommerceObject(client, target.configId, types.config, signal)
  const initial = await readConfig(), config = decodeConfig(initial.contents, target)
  const state = { target, coreVersion: types.version, config: sharedRef(initial), revision: config.revision,
    enabled: config.enabled, commitment: toHex(Uint8Array.from(config.commitment)) }
  if (config.treasury_id === null) {
    check(sameRef(initial, await readConfig()), 'CURRENT_CONFIG_CHANGED')
    signal.throwIfAborted()
    return { ...state, status: 'AWAITING_TREASURY' as const, treasury: null }
  }
  const treasuryId = config.treasury_id
  const readTreasury = () => readCommerceObject(client, treasuryId, types.treasury, signal)
  const first = await readTreasury(), treasury = sharedRef(first)
  const value = decodeTreasury(first.contents, treasuryId, config.id)
  // The Config read is bracketed by observations of the same Treasury version.
  check(sameRef(initial, await readConfig()), 'CURRENT_CONFIG_CHANGED')
  check(sameRef(first, await readTreasury()), 'CURRENT_TREASURY_CHANGED')
  signal.throwIfAborted()
  return { ...state, status: 'READY' as const, treasury: { ...treasury, balanceAtomic: String(value.balance),
    totalCollectedAtomic: String(value.collected), totalWithdrawnAtomic: String(value.withdrawn) } }
}

function parseOriginal(bytes64: string, digest: string, target: ProtocolRevenueTargetV8) {
  check(typeof bytes64 === 'string' && bytes64.length > 0 && bytes64.length <= 256 * 1024, 'PACKET_BOUND')
  const bytes = fromBase64(bytes64), raw = bcs.TransactionData.parse(bytes), v1 = raw.V1
  check(v1 && toBase64(bcs.TransactionData.serialize(raw).toBytes()) === bytes64
    && TransactionDataBuilder.getDigestFromBytes(bytes) === digest, 'PACKET_DIGEST')
  const valid = v1.expiration.ValidDuring, gas = v1.gasData
  if (valid) {
    check(valid.chain === MAINNET_GENESIS_DIGEST && valid.minEpoch !== null && valid.maxEpoch !== null
      && BigInt(valid.minEpoch) <= BigInt(valid.maxEpoch)
      && valid.minTimestamp === null && valid.maxTimestamp === null, 'VALID_DURING')
  }
  // The u64 ceiling for None is only an execution upper bound.
  const expirationEpoch = String(valid?.maxEpoch ?? v1.expiration.Epoch ?? MAX_EPOCH)
  const minimumExecutionEpoch = valid?.minEpoch ?? undefined
  const tx = Transaction.from(bytes).getData(), call = tx.commands[0]?.MoveCall
  check(tx.commands.length === 1 && call?.package === target.core.callablePackageId
    && call.module === MODULE && call.function === WITHDRAW
    && call.typeArguments.length === 1 && normalizeStructTag(call.typeArguments[0]) === target.coinType
    && call.arguments.length === 5 && tx.inputs.length === 5, 'WITHDRAWAL_GRAPH')
  const indices = call.arguments.map(arg => {
    check(arg.$kind === 'Input' && tx.inputs[arg.Input], 'INPUT_ARGUMENT')
    return arg.Input
  })
  check(new Set(indices).size === indices.length, 'INPUT_ALIAS')
  const [configArg, adminArg, treasuryArg, amountArg, recipientArg] = indices.map(index => tx.inputs[index])
  const config = configArg.Object?.SharedObject, admin = adminArg.Object?.ImmOrOwnedObject
  const treasury = treasuryArg.Object?.SharedObject
  check(config?.objectId === target.configId && !config.mutable && admin && treasury?.mutable, 'INPUT_REFERENCES')
  const gasIds = gas.payment.map(ref => ref.objectId)
  const ids = [config.objectId, admin.objectId, treasury.objectId, ...gasIds]
  check(commerceId(v1.sender) && commerceId(gas.owner) && BigInt(gas.budget) > 0n && BigInt(gas.price) > 0n
    && (gasIds.length === 0 ? valid : gasIds.length <= 256)
    && ids.every(commerceId) && new Set(ids).size === ids.length, 'GAS_OR_OBJECT_SCOPE')
  check(amountArg.Pure && recipientArg.Pure, 'PURE_ARGUMENTS')
  const amount = decodeCommerce(bcs.u64(), fromBase64(amountArg.Pure.bytes))
  const recipient = decodeCommerce(bcs.Address, fromBase64(recipientArg.Pure.bytes))
  check(BigInt(amount) > 0n && commerceId(recipient), 'WITHDRAWAL_INTENT')
  return { config, admin, treasury, amount, recipient, sender: v1.sender,
    gasIds, gasOwner: gas.owner, gasBudget: gas.budget, expirationEpoch, minimumExecutionEpoch }
}

async function proveAdmin(client: SuiGrpcClient, ref: ReturnType<typeof parseOriginal>['admin'],
  sender: string, configId: string, type: string, signal: AbortSignal) {
  const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({
    objectId: ref.objectId, version: BigInt(ref.version), readMask: { paths: ['object_id', 'version', 'digest', 'bcs'] },
  }, { abort: signal }))
  const row = response.object
  check(row?.objectId === ref.objectId && row.version === BigInt(ref.version) && row.digest === ref.digest
    && row.bcs?.value instanceof Uint8Array && row.bcs.value.length <= 1024, 'ADMIN_REFERENCE')
  const raw = collectionCommandRaw({ objectId: ref.objectId, version: String(ref.version), digest: ref.digest, bcs: toBase64(row.bcs.value) }), move = raw.data.Move
  check(move && historicalMoveObjectType(move.type) === type && raw.owner.AddressOwner === sender, 'ADMIN_OWNER_OR_TYPE')
  const value = decodeCommerce(Admin, move.contents)
  check(value.id === ref.objectId && value.version === '8' && value.config_id === configId, 'ADMIN_BINDING')
}

function proveEvent(bytes: Uint8Array, original: ReturnType<typeof parseOriginal>, target: ProtocolRevenueTargetV8, type: string) {
  const events = decodeCommerce(CollectionCommandEventsBcs, bytes), event = events[0]
  check(events.length === 1 && event.package_id === target.core.callablePackageId
    && event.transaction_module === MODULE && event.sender === original.sender
    && `${event.type_.address}::${event.type_.module}::${event.type_.name}` === type
    && event.type_.typeParams.length === 0, 'WITHDRAWAL_EVENT')
  const value = decodeCommerce(Withdrawal, event.contents)
  check(value.config_id === target.configId && value.treasury_id === original.treasury.objectId
    && value.operator === original.sender && value.recipient === original.recipient && value.amount === original.amount,
  'WITHDRAWAL_EVENT_BINDING')
}

function proveAddressGas(original: ReturnType<typeof parseOriginal>, context: FinalizedMutationContext, digest: string) {
  const e = context.effects.V2!, cost = e.gasUsed
  const net = BigInt(cost.computationCost) + BigInt(cost.storageCost) - BigInt(cost.storageRebate)
  check(e.gasObjectIndex === null && net <= BigInt(original.gasBudget), 'ADDRESS_GAS')
  const proof = assertAddressBalanceEffects({ effects: context.effects, transactionDigest: digest,
    changes: [{ owner: original.gasOwner, coinType: SUI_TYPE, delta: String(-net), touched: true }] })
  return { ...proof, owner: original.gasOwner, netGasCharge: String(net) }
}

async function proveWithdrawal(client: SuiGrpcClient, target: ProtocolRevenueTargetV8, digest: string,
  bytes: string, original: ReturnType<typeof parseOriginal>, context: FinalizedMutationContext) {
  const { effects, events, signal } = context, types = await readCore(client, target, signal)
  proveEvent(events, original, target, types.event)
  const e = effects.V2!, treasuryId = original.treasury.objectId
  const payouts = e.changedObjects.filter(([, change]) => change.idOperation.$kind === 'Created')
  check(payouts.length === 1, 'PAYOUT_COUNT')
  const addressGas = original.gasIds.length === 0 ? proveAddressGas(original, context, digest) : null
  const gasIds = addressGas?.accumulatorIds ?? original.gasIds
  const payoutId = payouts[0][0], ids = new Set([treasuryId, payoutId, ...gasIds])
  check(ids.size === gasIds.length + 2 && e.changedObjects.length === ids.size
    && new Set(e.changedObjects.map(([id]) => id)).size === ids.size && e.changedObjects.every(([id]) => ids.has(id))
    && e.unchangedConsensusObjects.length === 1, 'EFFECTS_SCOPE')
  const read = (objectId: string, type: string, mode: 'readonly' | 'input' | 'mutated' | 'created') =>
    readHistoricalMoveObject({ client, effects, transactionDigest: digest, objectId, type, mode, signal, maxBytes: 1024 })
  const [config, before, after, payout] = await Promise.all([
    read(target.configId, types.config, 'readonly'),
    read(treasuryId, types.treasury, 'input'),
    read(treasuryId, types.treasury, 'mutated'),
    read(payoutId, `0x2::coin::Coin<${target.coinType}>`, 'created'),
    proveAdmin(client, original.admin, original.sender, target.configId, types.admin, signal),
  ])
  check(config.object.owner.Shared?.initialSharedVersion === original.config.initialSharedVersion
    && decodeConfig(config.bytes, target).treasury_id === treasuryId
    && before.object.owner.Shared?.initialSharedVersion === original.treasury.initialSharedVersion
    && after.object.owner.Shared?.initialSharedVersion === original.treasury.initialSharedVersion, 'SHARED_INPUT_BINDING')
  const pre = decodeTreasury(before.bytes, treasuryId, target.configId), post = decodeTreasury(after.bytes, treasuryId, target.configId)
  const amount = BigInt(original.amount)
  check(pre.balance - post.balance === amount && post.collected === pre.collected
    && post.withdrawn - pre.withdrawn === amount, 'TREASURY_DEBIT')
  const coin = decodeCommerce(Coin, payout.bytes)
  check(payout.object.owner.AddressOwner === original.recipient && coin.id === payoutId && coin.balance === original.amount,
    'RECIPIENT_COIN')
  const gas = addressGas ?? await readSuiGasSettlement({ client, packet: { bytes, digest }, effects, signal, allowSponsored: true })
  return { coinType: target.coinType, configId: target.configId, adminCapId: original.admin.objectId,
    treasuryId, operator: original.sender, recipient: original.recipient, amountAtomic: original.amount,
    treasuryBefore: { version: String(before.reference.version), digest: before.reference.digest, balanceAtomic: String(pre.balance) },
    treasuryAfter: { version: String(after.reference.version), digest: after.reference.digest, balanceAtomic: String(post.balance) },
    payout: { objectId: payoutId, version: String(payout.reference.version), digest: payout.reference.digest }, gas }
}

/** Observe the exact original single-call withdrawal with address or coin gas.
 * Missing and pending are unresolved. This function only reads the ledger. */
export async function readOriginalProtocolWithdrawalV8(input: RevenueRead & { original: { bytes: string; digest: string } }) {
  const { client } = input, target = targetSnapshot(input.target), { bytes, digest } = structuredClone(input.original)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  const original = parseOriginal(bytes, digest, target)
  const result = await readFinalizedMutation({
    client, packet: { bytes, digest, expirationEpoch: original.expirationEpoch, phase: 'PREPARED', signature: null },
    minimumExecutionEpoch: original.minimumExecutionEpoch,
    chainIdentifier: '35834a8a', genesisDigest: MAINNET_GENESIS_DIGEST, signal, errorPrefix: 'PROTOCOL_REVENUE_V8',
    proveSuccess: context => proveWithdrawal(client, target, digest, bytes, original, context),
  })
  return { ...result, transactionDigest: digest }
}
