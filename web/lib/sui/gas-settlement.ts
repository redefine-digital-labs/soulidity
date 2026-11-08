import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { TransactionDataBuilder, Transaction } from '@mysten/sui/transactions'
import { fromBase64, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { readHistoricalMoveObject } from './historical-object'

const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
const SUI_COIN = normalizeStructTag('0x2::coin::Coin<0x2::sui::SUI>')
/** Exact SUI coin settlement when the business graph never uses
 * GasCoin. Proves original input balances, gas smashing and output balance.
 * Parent owes finality, every other effect and all other funding assets.
 * No live balances, signer or broadcaster. Net rebate may be negative gas. */
export async function readSuiGasSettlement(input: {
  client: SuiGrpcClient; packet: { bytes: string; digest: string }; effects: ReturnType<typeof bcs.TransactionEffects.parse>; signal: AbortSignal
  allowSponsored?: true
}) {
  const packet = { ...input.packet }, effects = structuredClone(input.effects)
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(60000)])
  function check(v: unknown, code: string): asserts v { if (!v) throw Error(`SUI_GAS_SETTLEMENT_${code}`) }
  check(typeof packet.bytes === 'string' && packet.bytes.length > 0 && packet.bytes.length <= 2 * 1024 * 1024, 'PACKET_BOUND')
  const bytes = fromBase64(packet.bytes), raw = bcs.TransactionData.parse(bytes), tx = raw.V1
  check(tx && toBase64(bcs.TransactionData.serialize(raw).toBytes()) === packet.bytes
    && TransactionDataBuilder.getDigestFromBytes(bytes) === packet.digest, 'PACKET')
  const e = effects.V2, gas = tx.gasData
  check(e?.status.$kind === 'Success' && e.transactionDigest === packet.digest && (tx.sender === gas.owner || input.allowSponsored === true)
    && BigInt(gas.budget) > 0n && BigInt(gas.price) > 0n && gas.payment.length > 0 && gas.payment.length <= 256, 'SCOPE')
  // This primitive deliberately excludes gas used as a business payment coin.
  const commands = Transaction.from(bytes).getData().commands
  function hasGas(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false
    if ('$kind' in value && value.$kind === 'GasCoin') return true
    return Object.values(value).some(hasGas)
  }
  check(!hasGas(commands), 'BUSINESS_GAS_USE')
  check(new Set(gas.payment.map(r => r.objectId)).size === gas.payment.length && e.gasObjectIndex !== null
    && e.gasObjectIndex < e.changedObjects.length && e.changedObjects[e.gasObjectIndex][0] === gas.payment[0].objectId, 'GAS_REFERENCE')
  let before = 0n
  for (const [index, ref] of gas.payment.entries()) {
    const source = await readHistoricalMoveObject({ client: input.client, effects, transactionDigest: packet.digest,
      objectId: ref.objectId, type: SUI_COIN, mode: 'input', signal, maxBytes: 128 })
    const coin = Coin.parse(source.bytes)
    check(source.reference.version === BigInt(ref.version) && source.reference.digest === ref.digest
      && source.object.owner.AddressOwner === gas.owner && coin.id === ref.objectId
      && toBase64(Coin.serialize(coin).toBytes()) === toBase64(source.bytes), 'INPUT')
    before += BigInt(coin.balance)
    if (index > 0) {
      const change = e.changedObjects.find(([id]) => id === ref.objectId)![1]
      check(change.idOperation.$kind === 'Deleted' && change.outputState.$kind === 'NotExist', 'SMASH_DISPOSITION')
    }
  }
  const output = await readHistoricalMoveObject({ client: input.client, effects, transactionDigest: packet.digest,
    objectId: gas.payment[0].objectId, type: SUI_COIN, mode: 'mutated', signal, maxBytes: 128 })
  const coin = Coin.parse(output.bytes), after = BigInt(coin.balance)
  const net = BigInt(e.gasUsed.computationCost) + BigInt(e.gasUsed.storageCost) - BigInt(e.gasUsed.storageRebate)
  check(output.object.owner.AddressOwner === gas.owner && coin.id === gas.payment[0].objectId
    && toBase64(Coin.serialize(coin).toBytes()) === toBase64(output.bytes)
    && before >= BigInt(gas.budget) && net <= BigInt(gas.budget) && before - after === net, 'BALANCE')
  return { proof: 'historical-sui-gas-settlement-only' as const, transactionDigest: packet.digest,
    owner: gas.owner, gasCoinIds: gas.payment.map(r => r.objectId), inputBalance: String(before), outputBalance: String(after),
    netGasCharge: String(net), notBusinessReceipt: true as const }
}
