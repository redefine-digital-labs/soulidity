import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, fromHex, toBase58, toBase64, toHex, normalizeStructTag } from '@mysten/sui/utils'
import { appendNativeSalePurchase } from './native-sale-transaction'
import { commerceCheck, commerceId } from './economics-read'
import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import type { readNativeSaleConditions } from './native-sale-conditions'
import type { readNativeSaleFunding } from './native-sale-funding'

interface ObjectRef { objectId: string; version: string; digest: string }
interface SharedRef { objectId: string; initialSharedVersion: string; mutable: boolean }
export interface NativeSaleGraphPlan {
  schema: 'soulidity.native-sale-graph.v1'; buyer: string; callablePackageId: string; coinType: string
  soulId: string; offerId: string; registryId: string; configId: string; policyId: string; sellerKioskId: string; buyerKioskId: string
  collectionId: string | null; buyerAccount: ObjectRef; generation: string; attemptHex: string; quoteExpiryMs: string
  reviewedTotal: string; paymentCoins: Array<ObjectRef & { balance: string }>; shared: SharedRef[]
  expirationEpoch: string; gas: { budget: string; price: string; coins: ObjectRef[] }
}
const MAX = 18446744073709551615n, CLOCK = `0x${'6'.padStart(64, '0')}`
function keys(value: object, expected: string[]) {
  commerceCheck(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join() === [...expected].sort().join(), 'SALE_GRAPH_FIELDS')
}
function uint(value: string, positive = false) {
  commerceCheck(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)
    && BigInt(value) <= MAX && (!positive || BigInt(value) > 0n), 'SALE_GRAPH_UINT')
}
function ref(value: ObjectRef) {
  commerceCheck(commerceId(value.objectId), 'SALE_GRAPH_OBJECT_ID'); uint(value.version, true)
  const bytes = fromBase58(value.digest)
  commerceCheck(bytes.length === 32 && toBase58(bytes) === value.digest, 'SALE_GRAPH_OBJECT_DIGEST')
}
/** Serializable frozen intent only. Package/source/quote/ownership/funding
 * authenticity is established upstream; a well-formed plan is not authority.
 * Explicit owned and shared references prevent SDK resolution from replacing
 * the reviewed funding/account or adding mutable shared permissions.
 */
export function parseNativeSaleGraphPlan(input: NativeSaleGraphPlan): NativeSaleGraphPlan {
  const p = structuredClone(input)
  keys(p, ['schema', 'buyer', 'callablePackageId', 'coinType', 'soulId', 'offerId', 'registryId', 'configId', 'policyId', 'sellerKioskId', 'buyerKioskId',
    'collectionId', 'buyerAccount', 'generation', 'attemptHex', 'quoteExpiryMs', 'reviewedTotal', 'paymentCoins', 'shared', 'expirationEpoch', 'gas'])
  keys(p.buyerAccount, ['objectId', 'version', 'digest']); keys(p.gas, ['budget', 'price', 'coins'])
  commerceCheck(p.schema === 'soulidity.native-sale-graph.v1' && [p.buyer, p.callablePackageId, p.soulId, p.offerId, p.registryId, p.configId,
    p.policyId, p.sellerKioskId, p.buyerKioskId].every(commerceId) && (p.collectionId === null || commerceId(p.collectionId)), 'SALE_GRAPH_IDENTITY')
  commerceCheck(p.coinType === normalizeStructTag(p.coinType) && p.sellerKioskId !== p.buyerKioskId, 'SALE_GRAPH_CURRENCY_OR_KIOSK')
  uint(p.generation); uint(p.quoteExpiryMs, true); uint(p.reviewedTotal, true); uint(p.expirationEpoch)
  commerceCheck(BigInt(p.expirationEpoch) <= BigInt(Number.MAX_SAFE_INTEGER) && typeof p.attemptHex === 'string'
    && /^(?:[0-9a-f]{2}){1,64}$/.test(p.attemptHex) && toHex(fromHex(p.attemptHex)) === p.attemptHex, 'SALE_GRAPH_ATTEMPT_OR_EXPIRATION')
  ref(p.buyerAccount); uint(p.gas.budget, true); uint(p.gas.price, true)
  commerceCheck(p.paymentCoins.length > 0 && p.paymentCoins.length <= 256 && p.gas.coins.length > 0 && p.gas.coins.length <= 256, 'SALE_GRAPH_COIN_BOUND')
  let balance = 0n
  for (const coin of p.paymentCoins) { keys(coin, ['objectId', 'version', 'digest', 'balance']); ref(coin); uint(coin.balance, true); balance += BigInt(coin.balance) }
  commerceCheck(balance >= BigInt(p.reviewedTotal) && balance <= MAX, 'SALE_GRAPH_FUNDING_AMOUNT')
  p.gas.coins.forEach(coin => { keys(coin, ['objectId', 'version', 'digest']); ref(coin) })
  const required = new Map<string, boolean>([[p.offerId, true], [p.registryId, false], [p.configId, true], [p.policyId, false],
    [p.sellerKioskId, true], [p.buyerKioskId, true], [CLOCK, false], ...(p.collectionId ? [[p.collectionId, false] as [string, boolean]] : [])])
  commerceCheck(required.size === 7 + (p.collectionId ? 1 : 0) && p.shared.length === required.size, 'SALE_GRAPH_SHARED_ALIASES')
  const ids = new Set<string>()
  for (const shared of p.shared) {
    keys(shared, ['objectId', 'initialSharedVersion', 'mutable'])
    uint(shared.initialSharedVersion, true)
    commerceCheck(required.has(shared.objectId) && shared.mutable === required.get(shared.objectId) && !ids.has(shared.objectId), 'SALE_GRAPH_SHARED_REFERENCE')
    ids.add(shared.objectId)
  }
  for (const object of [p.buyerAccount, ...p.paymentCoins, ...p.gas.coins]) {
    commerceCheck(!ids.has(object.objectId), 'SALE_GRAPH_OWNED_ALIAS_OR_GAS_OVERLAP'); ids.add(object.objectId)
  }
  commerceCheck(!ids.has(p.callablePackageId) && !ids.has(p.soulId) && p.soulId !== p.callablePackageId, 'SALE_GRAPH_PACKAGE_OR_ROOT_ALIAS')
  return p
}

export function buildNativeSaleGraph(input: NativeSaleGraphPlan) {
  const p = parseNativeSaleGraphPlan(input), tx = new Transaction()
  tx.setSender(p.buyer); tx.setGasOwner(p.buyer); tx.setGasBudget(p.gas.budget); tx.setGasPrice(p.gas.price)
  tx.setGasPayment(p.gas.coins); tx.setExpiration({ Epoch: p.expirationEpoch })
  const payments = p.paymentCoins.map(coin => tx.objectRef(coin))
  tx.objectRef(p.buyerAccount)
  for (const shared of p.shared) tx.sharedObjectRef(shared)
  if (payments.length > 1) tx.mergeCoins(payments[0], payments.slice(1))
  appendNativeSalePurchase(tx, { callablePackage: p.callablePackageId, coinType: p.coinType, offer: p.offerId, registry: p.registryId,
    config: p.configId, policy: p.policyId, sellerKiosk: p.sellerKioskId, buyerKiosk: p.buyerKioskId, buyerAccount: p.buyerAccount.objectId,
    generation: BigInt(p.generation), attempt: fromHex(p.attemptHex), expiryMs: BigInt(p.quoteExpiryMs),
    ...(p.collectionId ? { collection: p.collectionId } : {}) }, payments[0])
  return tx
}

/** Full post-build graph/reference/gas equality to the frozen plan, not just
 * checking the presence of a buy function. No extra calls/transfers/inputs,
 * sponsors, business GasCoin, reselected coins or rewritten bytes are allowed.
 * This does not itself prove wallet signature, package execution or success.
 */
export function assertNativeSaleGraph(input: NativeSaleGraphPlan, packet: { bytes: string; digest: string }) {
  const p = parseNativeSaleGraphPlan(input)
  commerceCheck(typeof packet.bytes === 'string' && packet.bytes.length > 0 && packet.bytes.length <= 180000, 'SALE_GRAPH_PACKET_BOUND')
  const bytes = fromBase64(packet.bytes), raw = bcs.TransactionData.parse(bytes)
  commerceCheck(toBase64(bcs.TransactionData.serialize(raw).toBytes()) === packet.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes) === packet.digest, 'SALE_GRAPH_PACKET_DIGEST')
  const actual = Transaction.from(bytes).getData(), expected = buildNativeSaleGraph(p).getData()
  commerceCheck(Number.isSafeInteger(raw.V1.expiration.Epoch) && String(raw.V1.expiration.Epoch) === p.expirationEpoch, 'SALE_GRAPH_EXPIRATION_MISMATCH')
  // SDK builder Input.type is a construction hint, absent from wire BCS.
  // Input identity and actual Pure/Object data remain compared in full.
  const wireCommands = (commands: typeof actual.commands) => JSON.parse(JSON.stringify(commands, (_key, value) =>
    value?.$kind === 'Input' ? { $kind: 'Input', Input: value.Input } : value))
  for (const field of ['sender', 'gasData', 'inputs', 'commands'] as const) {
    const left = field === 'commands' ? wireCommands(actual.commands) : actual[field]
    const right = field === 'commands' ? wireCommands(expected.commands) : expected[field]
    commerceCheck(publicMutationCanonical(left) === publicMutationCanonical(right), `SALE_GRAPH_${field.toUpperCase()}_MISMATCH`)
  }
  return { proof: 'native-sale-frozen-transaction-graph-only' as const, transactionDigest: packet.digest,
    buyer: p.buyer, reviewedTotal: p.reviewedTotal, notSignatureOrReceipt: true as const }
}

/** Bind fresh local reader results to the frozen intent before construction.
 * Serialized/imported copies are not proof: caller must run the actual current
 * readers and wallet guard. No proof callback or cached-success default exists.
 */
export function assertNativeSalePlanObservations(input: NativeSaleGraphPlan, conditions: Awaited<ReturnType<typeof readNativeSaleConditions>>,
  funding: Awaited<ReturnType<typeof readNativeSaleFunding>>) {
  const p = parseNativeSaleGraphPlan(input), c = conditions
  commerceCheck(c.release.chainIdentifier === '35834a8a' && c.release.native.callablePackageId === p.callablePackageId
    && c.release.coinType === p.coinType && c.release.configId === p.configId && c.release.registryId === p.registryId
    && c.soulId === p.soulId && c.offerId === p.offerId && c.buyer === p.buyer && c.buyerKioskId === p.buyerKioskId
    && c.offer.policyId === p.policyId && c.offer.sellerKioskId === p.sellerKioskId && c.offer.generation === p.generation
    && c.offer.collectionId === p.collectionId && String(c.quote.total) === p.reviewedTotal
    && publicMutationCanonical(c.buyerAccount) === publicMutationCanonical(p.buyerAccount), 'SALE_GRAPH_CONDITIONS_MISMATCH')
  commerceCheck(funding.buyer === p.buyer && funding.coinType === p.coinType && funding.required === p.reviewedTotal
    && publicMutationCanonical(funding.coins) === publicMutationCanonical(p.paymentCoins)
    && publicMutationCanonical(funding.gasCoinIds) === publicMutationCanonical(p.gas.coins.map(coin => coin.objectId)), 'SALE_GRAPH_FUNDING_MISMATCH')
  return { proof: 'native-sale-conditions-and-funding-plan-binding-only' as const, notAuthorization: true as const }
}
