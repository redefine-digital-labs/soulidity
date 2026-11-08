import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { toBase64 } from '@mysten/sui/utils'
import { expect, vi } from 'vitest'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'
import { EpochCheckpointSummaryBcs, epochCheckpointDigest } from '../../../web/lib/sui/epoch-checkpoint'
import type { PublicMutationPacket } from '../../../web/lib/sui/public-mutation-journal'

export async function nativeSaleRetirementFixture(client: SuiGrpcClient, packet: PublicMutationPacket, gasCoinId: string,
  options: { epoch?: number; gasChanged?: true; originalFound?: true; differentCheckpoint?: true } = {}) {
  const gas = (await client.ledgerService.getObject({ objectId: gasCoinId })).response.object!
  const epoch = options.epoch ?? Number(packet.expirationEpoch) + 1
  const sequence = 812, zero = Array.from({ length: 32 }, () => 0)
  const bytes = EpochCheckpointSummaryBcs.serialize({ epoch, sequence_number: sequence, network_total_transactions: 1000,
    content_digest: zero, previous_digest: zero, epoch_rolling_gas_cost_summary: {
      computation_cost: 0, storage_cost: 0, storage_rebate: 0, non_refundable_storage_fee: 0,
    }, timestamp_ms: 100, checkpoint_commitments: [], end_of_epoch_data: null, version_specific_data: [] }).toBytes()
  const digest = epochCheckpointDigest(bytes), recorded = { sequenceNumber: String(sequence), epoch: String(epoch), digest, bytes: toBase64(bytes) }
  const getCheckpoint = vi.spyOn(client.ledgerService, 'getCheckpoint').mockImplementation((async request => {
    expect(request.checkpointId).toEqual({ oneofKind: 'sequenceNumber', sequenceNumber: BigInt(sequence) })
    return { response: { checkpoint: { sequenceNumber: BigInt(sequence), digest,
      summary: { sequenceNumber: BigInt(sequence), epoch: BigInt(epoch), digest, bcs: { value: bytes } },
      signature: { epoch: BigInt(epoch), signature: new Uint8Array(48), bitmap: new Uint8Array([1]) } } } }
  }) as typeof client.ledgerService.getCheckpoint)
  const fetch = vi.fn(async (url: string, request: RequestInit) => {
    expect(url).toBe('https://graphql.mainnet.sui.io/graphql')
    expect(request.credentials).toBe('omit')
    const variables = JSON.parse(String(request.body)).variables
    expect(variables).toMatchObject({ coin: gasCoinId, digest: packet.digest })
    expect(variables.checkpoint === null || variables.checkpoint === sequence).toBe(true)
    return new Response(JSON.stringify({ data: { chainIdentifier: MAINNET_GENESIS_DIGEST, checkpoint: {
      sequenceNumber: sequence, epoch: { epochId: epoch }, digest: options.differentCheckpoint ? packet.digest : digest,
      query: { transaction: options.originalFound ? { digest: packet.digest } : null,
        object: { address: gasCoinId, version: Number(gas.version) + (options.gasChanged ? 1 : 0), digest: gas.digest, objectBcs: toBase64(gas.bcs!.value!) } },
    } } }))
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, getCheckpoint, recorded }
}
