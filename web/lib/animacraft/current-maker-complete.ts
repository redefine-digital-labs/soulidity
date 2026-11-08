import { Transaction, type TransactionArgument, type TransactionObjectArgument } from '@mysten/sui/transactions'
import type { PinnedMovePackage } from '../sui/pinned-move-package'
import { currentMakerId as id, currentMakerU64 as uint, currentMakerHex as hex,
  validateCurrentMakerPackage, validateCurrentMakerTarget, type CurrentMakerTarget } from './current-maker-transactions'

export interface CurrentCompleteTarget extends CurrentMakerTarget {
  runtime: PinnedMovePackage
  publication: PinnedMovePackage
  model: PinnedMovePackage
  kindRegistryId: string
}
export interface CurrentCompletePayment { amount: string; coinIds: string[] }
export interface CurrentCompleteProduct {
  productId: string; version: string; policyHash: string; payment: CurrentCompletePayment
}
export interface CurrentCompleteBlob { blobObjectId: string; sha256: string; envelope: number[] }
export interface CurrentCompleteInput {
  schema: 'animacraft.current-complete.v1'
  target: CurrentCompleteTarget; actor: string; maker: CurrentCompleteProduct; packs: CurrentCompleteProduct[]
  playerId: string; expectedPlayerRevision: string
  /** Indices into the actual Player.parts vector, not client-created Scopes. */
  selections: { productId: string; partIndex: number }[]
  outputKeyHex: string; outputPolicyHash: string; recipeHash: string; attempt: string; nonce: string; name: string
  feeRevision: string; expiryMs: string
  initialContent: (CurrentCompleteBlob & { kind: number; name: string })[]
  configuration: { key: string; value: number[] }[]
  render: CurrentCompleteBlob
}
const check = (v: unknown, message: string): void => { if (!v) throw new Error(`CURRENT_COMPLETE_INVALID: ${message}`) }
function bytes(value: number[], max: number): number[] {
  check(Array.isArray(value) && value.length <= max && value.every(v => Number.isInteger(v) && v >= 0 && v <= 255), 'bounded bytes required')
  return value
}
function text(value: string, max: number) {
  check(typeof value === 'string' && value.length > 0 && new TextEncoder().encode(value).length <= max, 'bounded nonempty UTF-8 text required')
  return value
}

/** Complete consumes the one-use current Build in one PTB: real payments,
 * issued selections, certified Blob values, live finish and Standard delivery.
 * This is a new independent-producer operation, not a Native mint or a legacy
 * v8 recovery. No sign/broadcast/finality is performed here. Pin metadata is
 * not live deployment, content certification, fee quote or effects evidence.
 */
export function buildCurrentMakerComplete(input: CurrentCompleteInput): Transaction {
  const p = structuredClone(input)
  check(p.schema === 'animacraft.current-complete.v1', 'new current schema required; historical operations retain their original composer')
  const t = validateCurrentMakerTarget(p.target)
  const runtime = validateCurrentMakerPackage(p.target.runtime), publication = validateCurrentMakerPackage(p.target.publication), model = validateCurrentMakerPackage(p.target.model)
  id(p.actor); id(p.playerId); id(p.target.kindRegistryId)
  check(Array.isArray(p.packs) && p.packs.length <= 63, 'Pack count exceeds Assembly scopes')
  const products = [p.maker, ...p.packs], productIds = products.map(row => id(row.productId))
  check(new Set(productIds).size === products.length && !productIds.includes(p.playerId), 'duplicate/aliased products')
  for (const row of products) { uint(row.version, true); hex(row.policyHash, 32); uint(row.payment.amount) }
  uint(p.expectedPlayerRevision); uint(p.feeRevision); uint(p.expiryMs, true)
  hex(p.outputPolicyHash, 32); hex(p.recipeHash, 32); hex(p.attempt, 32); hex(p.nonce, 16); text(p.name, 128)
  check(typeof p.outputKeyHex === 'string' && /^(?:[0-9a-f]{2}){1,64}$/.test(p.outputKeyHex), 'output key must be 1..64 bytes')
  check(Array.isArray(p.selections) && p.selections.length > 0 && p.selections.length <= 512, '1..512 selected parts required')
  const indices = new Set<number>(), used = new Set<string>()
  for (const s of p.selections) {
    check(productIds.includes(s.productId) && Number.isInteger(s.partIndex) && s.partIndex >= 0 && s.partIndex < 512 && !indices.has(s.partIndex), 'invalid/duplicate selected part')
    indices.add(s.partIndex); used.add(s.productId)
  }
  check(p.packs.every(row => used.has(row.productId)), 'included Pack must supply an actual selection')
  check(Array.isArray(p.initialContent) && p.initialContent.length <= 64, 'initial content count')
  const slots = new Set<string>(), blobIds = new Set<string>()
  for (const row of [...p.initialContent, p.render]) {
    id(row.blobObjectId); hex(row.sha256, 32); bytes(row.envelope, 65536)
    check(!blobIds.has(row.blobObjectId), 'Blob consumed more than once'); blobIds.add(row.blobObjectId)
  }
  for (const row of p.initialContent) {
    check(Number.isInteger(row.kind) && row.kind >= 0 && row.kind <= 4294967295, 'content kind outside u32')
    text(row.name, 128); const key = `${row.kind}:${row.name}`
    check(!slots.has(key), 'duplicate initial content slot'); slots.add(key)
  }
  check(Array.isArray(p.configuration) && p.configuration.length <= 64, 'configuration count')
  const keys = new Set<string>()
  for (const row of p.configuration) { text(row.key, 128); bytes(row.value, 65536); check(!keys.has(row.key), 'duplicate config key'); keys.add(row.key) }
  const tx = new Transaction(); tx.setSender(p.actor)
  const cfg = tx.object(t.configId), system = tx.object(t.walrusSystemId), clock = tx.object('0x6'), maker = tx.object(p.maker.productId), player = tx.object(p.playerId)
  const vector = (value: string, n: number) => tx.pure.vector('u8', hex(value, n))
  const runtimeCall = (name: string, args: TransactionArgument[], generic = true) => tx.moveCall({
    target: `${runtime.callablePackageId}::runtime::${name}`, typeArguments: generic ? [t.paymentCoinType] : [], arguments: args,
  })
  // Merge each selected coin once. Reuse its remaining balance for subsequent
  // product contributions; a zero quote uses Coin::zero without a withdrawal.
  const allCoins = new Set<string>(), forbidden = new Set([...productIds, p.playerId, t.configId, t.walrusSystemId, p.target.kindRegistryId, ...blobIds])
  let primary: TransactionObjectArgument | undefined
  for (const row of products) {
    check(Array.isArray(row.payment.coinIds) && row.payment.coinIds.length <= 256 && new Set(row.payment.coinIds).size === row.payment.coinIds.length, 'unique bounded coin list required')
    check(BigInt(row.payment.amount) === 0n ? row.payment.coinIds.length === 0 : row.payment.coinIds.length > 0, 'coin selection must match zero/positive quote')
    for (const coin of row.payment.coinIds) { id(coin); check(!forbidden.has(coin), 'payment role alias'); allCoins.add(coin) }
  }
  check(allCoins.size <= 256, 'combined coin count exceeds bound')
  if (allCoins.size) {
    const coins = [...allCoins]; primary = tx.object(coins[0])
    if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map(coin => tx.object(coin)))
  }
  const payment = (row: CurrentCompleteProduct) => BigInt(row.payment.amount) === 0n
    ? tx.moveCall({ target: '0x2::coin::zero', typeArguments: [t.paymentCoinType], arguments: [] })
    : tx.splitCoins(primary!, [tx.pure.u64(row.payment.amount)])[0]
  const intent = tx.moveCall({ target: `${publication.callablePackageId}::output_data::intent`, arguments: [
    tx.pure.id(t.configId), tx.pure.id(p.maker.productId), tx.pure.u64(p.maker.version), vector(p.maker.policyHash, 32), vector(p.outputPolicyHash, 32),
    tx.pure.address(p.actor), vector(p.attempt, 32), tx.pure.string(p.name), vector(p.recipeHash, 32), vector(p.nonce, 16),
  ] })
  const build = runtimeCall('begin', [maker, cfg, intent, vector(p.outputKeyHex, p.outputKeyHex.length / 2), tx.pure.u64(p.feeRevision),
    tx.pure.u64(p.expiryMs), payment(p.maker), clock, system])
  for (const pack of p.packs) runtimeCall('include_pack', [build, tx.object(pack.productId), maker, cfg, tx.pure.u64(pack.version),
    vector(pack.policyHash, 32), tx.pure.u64(p.feeRevision), tx.pure.u64(p.expiryMs), payment(pack), clock, system])
  for (const selection of p.selections) {
    const parts = tx.moveCall({ target: `${t.manufacturing.callablePackageId}::maker_player::parts`, arguments: [player] })
    const part = tx.moveCall({ target: '0x1::vector::remove', typeArguments: [`${model.originalPackageId}::assembly::PartKey`], arguments: [parts, tx.pure.u64(selection.partIndex)] })
    runtimeCall('select_player_scoped', [build, tx.object(selection.productId), player, part, tx.pure.u64(p.expectedPlayerRevision), cfg, system])
  }
  for (const content of p.initialContent) runtimeCall('append_initial_content', [build, tx.object(p.target.kindRegistryId), tx.pure.u32(content.kind), tx.pure.string(content.name),
    tx.object(content.blobObjectId), system, vector(content.sha256, 32), tx.pure.vector('u8', content.envelope), clock], false)
  for (const row of p.configuration) runtimeCall('set_initial_state_config', [build, tx.pure.string(row.key), tx.pure.vector('u8', row.value), system], false)
  runtimeCall('finish_live', [build, cfg, clock, tx.object(p.render.blobObjectId), system, vector(p.render.sha256, 32), tx.pure.vector('u8', p.render.envelope)])
  return tx
}

/** The selected V1 runtime consumes an actual installed application binding.
 * Generic manufacture-only Config eligibility does not prove this capability.
 * Public assertion only; never registers/enables any Native service or role. */
export function buildCurrentCompleteRuntimeRead(input: { target: CurrentCompleteTarget; actor: string }): Transaction {
  const target = validateCurrentMakerTarget(input.target), runtime = validateCurrentMakerPackage(input.target.runtime), tx = new Transaction()
  tx.setSender(id(input.actor))
  tx.moveCall({ target: `${runtime.callablePackageId}::native_binding::assert_current`, typeArguments: [target.paymentCoinType], arguments: [tx.object(target.configId)] })
  return tx
}
