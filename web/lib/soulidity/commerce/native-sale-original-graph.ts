import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import { marketListDigest } from '../../animacraft/market-list-operation'
import type { FinalizedMutationContext } from '../../sui/finalized-mutation'
import { readHistoricalMoveObject } from '../../sui/historical-object'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import { commerceCheck as check, commerceId, decodeCommerce } from './economics-read'
import { assertNativeSaleGraph, type NativeSaleGraphPlan } from './native-sale-graph'

const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })

/** Locate an exact transaction envelope. Checkpoint and effects are verified
 * separately, and the bytes must match when that finalized row is reread. */
export async function readNativeSaleClosingPacket(client: SuiGrpcClient, digest: string, signal: AbortSignal) {
  check(marketListDigest(digest), 'NATIVE_CLOSURE_DIGEST')
  let row
  try {
    row = (await profileReadStep(signal, () => client.ledgerService.getTransaction({ digest,
      readMask: { paths: ['digest', 'transaction.digest', 'transaction.bcs'] } }, { abort: signal }))).response.transaction
  } catch (error) {
    signal.throwIfAborted()
    if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return null
    throw error
  }
  const bytes = row?.transaction?.bcs?.value
  check(row?.digest === digest && row.transaction?.digest === digest && bytes instanceof Uint8Array
    && bytes.length > 0 && bytes.length <= 135000 && TransactionDataBuilder.getDigestFromBytes(bytes) === digest, 'NATIVE_CLOSURE_BYTES')
  const raw = decodeCommerce(bcs.TransactionData, bytes), tx = raw.V1, expiration = tx.expiration.Epoch
  check(tx.kind.ProgrammableTransaction && Number.isSafeInteger(expiration) && commerceId(tx.sender), 'NATIVE_CLOSURE_PACKET')
  const packet: PublicMutationPacket = { bytes: toBase64(bytes), digest, expirationEpoch: String(expiration), phase: 'PREPARED', signature: null }
  return { packet, tx, ptb: tx.kind.ProgrammableTransaction }
}

type Closing = NonNullable<Awaited<ReturnType<typeof readNativeSaleClosingPacket>>>
type Argument = ReturnType<typeof bcs.Argument.parse>

/** Recover only the exact Native checkout graph, including merged owned coins
 * and dynamic split from on-chain quote total. Rebuild-and-compare rejects any
 * argument, input, gas, type, or command outside that graph. */
export function decodeNativeSaleClosingPurchase(closing: Closing, expected: {
  soulId: string; offerId: string; callablePackageId: string; coinType: string; registryId: string; configId: string
  policyId: string; sellerKioskId: string; collectionId: string | null
}) {
  const { tx, ptb: { inputs, commands }, packet } = closing
  const length = commands.length, buy = commands.at(-1)?.MoveCall, quote = commands.at(-4)?.MoveCall
  const split = commands.at(-2)?.SplitCoins, merge = length === 5 ? commands[0].MergeCoins : undefined
  const withCollection = expected.collectionId !== null
  check((length === 4 || length === 5 && merge) && inputs.length <= 270 && buy && quote && split
    && buy.package === expected.callablePackageId && buy.module === 'market'
    && buy.function === (withCollection ? 'buy_with_collection' : 'buy') && buy.arguments.length === (withCollection ? 11 : 10)
    && quote.arguments.length === (withCollection ? 8 : 7)
    && buy.typeArguments.length === 1 && normalizeStructTag(buy.typeArguments[0]) === expected.coinType, 'NATIVE_CLOSURE_BUY_GRAPH')
  const input = (arg: Argument) => {
    check(arg.Input !== undefined && inputs[arg.Input], 'NATIVE_CLOSURE_INPUT')
    return inputs[arg.Input]
  }
  const shared = (arg: Argument) => {
    const row = input(arg).Object?.SharedObject
    check(row, 'NATIVE_CLOSURE_SHARED')
    return row.objectId
  }
  const owned = (arg: Argument) => {
    const row = input(arg).Object?.ImmOrOwnedObject
    check(row, 'NATIVE_CLOSURE_OWNED')
    return { objectId: row.objectId, version: String(row.version), digest: row.digest }
  }
  const pure = (arg: Argument) => {
    const row = input(arg).Pure
    check(row, 'NATIVE_CLOSURE_PURE')
    return fromBase64(row.bytes)
  }
  const args = buy.arguments, sellerKiosk = withCollection ? 5 : 4, generation = withCollection ? 4 : 3
  check(shared(args[0]) === expected.offerId && shared(args[1]) === expected.registryId
    && shared(args[2]) === expected.configId && shared(args[3]) === expected.policyId
    && (!withCollection || shared(args[4]) === expected.collectionId) && shared(args[sellerKiosk]) === expected.sellerKioskId,
  'NATIVE_CLOSURE_OFFER_SCOPE')
  const paymentRefs = [split.coin, ...(merge?.sources ?? [])].map(owned)
  const gas = tx.gasData
  const shape: NativeSaleGraphPlan = {
    ...expected, schema: 'soulidity.native-sale-graph.v1', buyer: tx.sender, buyerKioskId: shared(args[sellerKiosk + 1]),
    buyerAccount: owned(args[sellerKiosk + 2]), generation: decodeCommerce(bcs.u64(), pure(quote.arguments[generation])),
    attemptHex: toHex(decodeCommerce(bcs.byteVector(), pure(quote.arguments[generation + 1]))),
    quoteExpiryMs: decodeCommerce(bcs.u64(), pure(quote.arguments[generation + 2])),
    shared: inputs.flatMap(row => {
      const shared = row.Object?.SharedObject
      return shared ? [{ objectId: shared.objectId, initialSharedVersion: String(shared.initialSharedVersion), mutable: shared.mutable }] : []
    }),
    expirationEpoch: packet.expirationEpoch,
    gas: { budget: gas.budget, price: gas.price, coins: gas.payment.map(coin => ({ objectId: coin.objectId, version: String(coin.version), digest: coin.digest })) },
    reviewedTotal: '1', paymentCoins: paymentRefs.map(coin => ({ ...coin, balance: '1' })),
  }
  // Values absent from the PTB are placeholders for wire equality only.
  assertNativeSaleGraph(shape, packet)
  return { shape, async proveFunding(client: SuiGrpcClient, ctx: FinalizedMutationContext, total: string) {
    const paymentCoins: NativeSaleGraphPlan['paymentCoins'] = []
    for (const ref of paymentRefs) {
      const row = await readHistoricalMoveObject({ client, effects: ctx.effects, transactionDigest: packet.digest, objectId: ref.objectId,
        type: `0x2::coin::Coin<${shape.coinType}>`, mode: 'input', signal: ctx.signal })
      const coin = decodeCommerce(Coin, row.bytes)
      check(row.reference.version === BigInt(ref.version) && row.reference.digest === ref.digest
        && row.object.owner.AddressOwner === tx.sender && coin.id === ref.objectId, 'NATIVE_CLOSURE_FUNDING')
      paymentCoins.push({ ...ref, balance: coin.balance })
    }
    return { ...shape, reviewedTotal: total, paymentCoins }
  } }
}
