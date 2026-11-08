import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { profileReadStep } from '@soulidity/sdk'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import { commerceCheck as check } from './economics-read'

export async function simulateNativeSalePacket(client: SuiGrpcClient, packet: PublicMutationPacket, signal: AbortSignal) {
  const { response } = await profileReadStep(signal, () => client.transactionExecutionService.simulateTransaction({
    transaction: { bcs: { value: fromBase64(packet.bytes) } }, checks: 0, doGasSelection: false,
    readMask: { paths: ['transaction.digest', 'transaction.transaction.bcs', 'transaction.effects.bcs',
      'transaction.effects.transaction_digest', 'transaction.effects.status', 'transaction.checkpoint', 'transaction.signatures'] },
  }, { abort: signal }))
  const row = structuredClone(response.transaction), raw = row?.effects?.bcs?.value
  check(row?.digest === packet.digest && row.transaction?.bcs?.value instanceof Uint8Array
    && toBase64(row.transaction.bcs.value) === packet.bytes && row.checkpoint === undefined && row.signatures.length === 0
    && row.effects?.transactionDigest === packet.digest && row.effects?.status?.success === true
    && raw instanceof Uint8Array && raw.length <= 1024 * 1024, 'SALE_CHECKOUT_SIMULATION')
  const effects = bcs.TransactionEffects.parse(raw)
  check(toBase64(bcs.TransactionEffects.serialize(effects).toBytes()) === toBase64(raw)
    && effects.V2?.transactionDigest === packet.digest && effects.V2.status.$kind === 'Success'
    && BigInt(effects.V2.executedEpoch) <= BigInt(packet.expirationEpoch), 'SALE_CHECKOUT_SIMULATION_EFFECTS')
}
