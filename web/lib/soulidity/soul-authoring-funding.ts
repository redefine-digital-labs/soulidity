import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { Transaction } from '@mysten/sui/transactions'
import { normalizeStructTag, toBase58, toBase64 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { profileReadStep } from '@soulidity/sdk'
import { historicalMoveObjectType } from '../sui/historical-object'
import { soulAuthoringPacketCheck as check } from './soul-authoring-packet'

const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
/** Re-resolve only the independently constructed SDK funding intents using
 * the original packet's authenticated coin selection/withdrawal amounts. New
 * incoming coins, pagination or address-balance increases cannot change it.
 * Candidate commands are never copied; SDK generates the entire funding graph,
 * which the caller then compares byte-for-byte and simulates against live state. */
export async function resolveSoulAuthoringFunding(params: {
  expected: Transaction; candidate: Transaction; client: SuiGrpcClient; author: string; signal: AbortSignal
}) {
  const { expected, client, author, signal } = params, template = expected.getData(), actual = params.candidate.getData()
  const intents = template.commands.flatMap(c => c.$Intent ? [c.$Intent] : [])
  if (!intents.length) return
  check(intents.every(i => i.name === 'CoinWithBalance' && typeof i.data.type === 'string'
    && typeof i.data.balance === 'bigint' && i.data.balance >= 0n), 'FUNDING_INTENT_INVALID')
  const types = new Set(intents.map(i => normalizeStructTag(i.data.type as string)))
  check(types.size === 1, 'FUNDING_TYPE_AMBIGUOUS')
  const type = [...types][0], total = intents.reduce((sum, i) => sum + (i.data.balance as bigint), 0n)
  const businessIds = new Set(template.inputs.flatMap(i => {
    const id = i.UnresolvedObject?.objectId ?? i.Object?.ImmOrOwnedObject?.objectId ?? i.Object?.SharedObject?.objectId
    return id ? [id] : []
  }))
  const refs = actual.inputs.flatMap(i => i.Object?.ImmOrOwnedObject && !businessIds.has(i.Object.ImmOrOwnedObject.objectId)
    ? [i.Object.ImmOrOwnedObject] : [])
  check(new Set(refs.map(r => r.objectId)).size === refs.length, 'FUNDING_COIN_ALIAS')
  const coins: Array<{ objectId: string; version: string; digest: string; balance: string }> = []
  for (const ref of refs) {
    const { response } = await profileReadStep(signal, () => client.ledgerService.getObject({ objectId: ref.objectId,
      version: BigInt(ref.version), readMask: { paths: ['object_id', 'version', 'digest', 'bcs'] } }, { abort: signal }))
    const row = response.object, bytes = row?.bcs?.value
    check(row?.objectId === ref.objectId && row.version === BigInt(ref.version) && row.digest === ref.digest
      && bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 4096, 'FUNDING_COIN_REFERENCE')
    const prefix = new TextEncoder().encode('Object::'), preimage = new Uint8Array(prefix.length + bytes.length)
    preimage.set(prefix); preimage.set(bytes, prefix.length)
    const object = bcs.Object.parse(bytes), move = object.data.Move
    check(toBase58(blake2b(preimage, { dkLen: 32 })) === ref.digest
      && toBase64(bcs.Object.serialize(object).toBytes()) === toBase64(bytes)
      && move?.version === String(ref.version) && object.owner.AddressOwner === author
      && historicalMoveObjectType(move.type) === normalizeStructTag(`0x2::coin::Coin<${type}>`), 'FUNDING_COIN_BYTES_OR_OWNER')
    const coin = Coin.parse(move.contents)
    check(coin.id === ref.objectId && toBase64(Coin.serialize(coin).toBytes()) === toBase64(move.contents), 'FUNDING_COIN_CONTENT')
    coins.push({ ...ref, version: String(ref.version), balance: coin.balance })
  }
  let withdrawal = 0n
  for (const input of actual.inputs) if (input.FundsWithdrawal) {
    const w = input.FundsWithdrawal
    check(w.typeArg.Balance === type && w.withdrawFrom.$kind === 'Sender' && w.reservation.$kind === 'MaxAmountU64'
      && BigInt(w.reservation.MaxAmountU64!) > 0n, 'FUNDING_WITHDRAWAL_INVALID')
    withdrawal += BigInt(w.reservation.MaxAmountU64!)
  }
  const balance = coins.reduce((sum, c) => sum + BigInt(c.balance), 0n)
  check(withdrawal <= total && balance + withdrawal >= total, 'FUNDING_AMOUNT_INVALID')
  function request(input: { owner: string; coinType?: string; cursor?: string | null }) {
    signal.throwIfAborted()
    check(input.owner === author && input.coinType && normalizeStructTag(input.coinType) === type && !input.cursor, 'FUNDING_REQUEST_SCOPE')
  }
  const core = new Proxy(client.core, { get(target, name) {
    if (name === 'listCoins') return async (input: Parameters<typeof request>[0]) => {
      request(input); return { objects: structuredClone(coins), hasNextPage: false, cursor: null }
    }
    if (name === 'getBalance') return async (input: Parameters<typeof request>[0]) => {
      request(input); return { balance: { balance: String(balance + withdrawal), coinBalance: String(balance), addressBalance: String(withdrawal) } }
    }
    const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value
  } })
  const limited = new Proxy(client, { get(target, name) {
    if (name === 'core') return core
    const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value
  } })
  await profileReadStep(signal, () => expected.prepareForSerialization({ client: limited }))
}
