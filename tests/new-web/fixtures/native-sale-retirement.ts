import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { activityEvidenceFixture, aid } from './activity-transaction-evidence'
import { objectRow } from './commerce-native-sale-lifecycle-wire'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { toBase64 } from '@mysten/sui/utils'
import { expect, vi } from 'vitest'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'
import { EpochCheckpointSummaryBcs, epochCheckpointDigest } from '../../../web/lib/sui/epoch-checkpoint'
import type { PublicMutationPacket } from '../../../web/lib/sui/public-mutation-journal'

export async function nativeSaleRetirementFixture(client: SuiGrpcClient, packet: PublicMutationPacket, gasCoinId: string,
  options: { epoch?: number; gasChanged?: true; originalFound?: true; differentCheckpoint?: true;
    observedGas?: { version: bigint; digest: string; bcs: { value: Uint8Array } } | null } = {}) {
  const gas = (await client.ledgerService.getObject({ objectId: gasCoinId })).response.object!
  const observed = options.observedGas === undefined ? gas : options.observedGas
  const epoch = options.epoch ?? Number(packet.expirationEpoch) + 1
  const sequence = 812, zero = Array.from({ length: 32 }, () => 0)
  const bytes = EpochCheckpointSummaryBcs.serialize({ epoch, sequence_number: sequence, network_total_transactions: 1000,
    content_digest: zero, previous_digest: zero, epoch_rolling_gas_cost_summary: {
      computation_cost: 0, storage_cost: 0, storage_rebate: 0, non_refundable_storage_fee: 0,
    }, timestamp_ms: 100, checkpoint_commitments: [], end_of_epoch_data: null, version_specific_data: [] }).toBytes()
  const digest = epochCheckpointDigest(bytes), recorded = { sequenceNumber: String(sequence), epoch: String(epoch), digest, bytes: toBase64(bytes) }
  const getCheckpoint = vi.spyOn(client.ledgerService, 'getCheckpoint').mockImplementation((async request => {
    expect(request.checkpointId).toEqual(request.checkpointId?.oneofKind === 'sequenceNumber'
      ? { oneofKind: 'sequenceNumber', sequenceNumber: BigInt(sequence) } : { oneofKind: undefined })
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
        object: observed ? { address: gasCoinId, version: Number(observed.version) + (options.gasChanged ? 1 : 0),
          digest: observed.digest, objectBcs: toBase64(observed.bcs!.value!) } : null },
    } } }))
  })
  vi.stubGlobal('fetch', fetch)
  return { fetch, getCheckpoint, recorded }
}

type CoinRow = Pick<ReturnType<typeof objectRow>, 'objectId' | 'version' | 'digest' | 'objectType' | 'bcs'>
type Spend = Awaited<ReturnType<typeof nativeSaleGasSpendFixture>>

export async function nativeSaleGasSpendFixture(input: CoinRow, sequence: number, options: { failure?: true; primary?: CoinRow } = {}) {
  const evidence = await activityEvidenceFixture({ empty: true })
  const source = bcs.Object.parse(input.bcs.value), owner = source.owner.AddressOwner!
  const refs = options.primary ? [options.primary, input] : [input]
  const outputVersion = refs.reduce((version, row) => row.version > version ? row.version : version, 0n) + 1n
  const tx = new Transaction()
  tx.setSender(owner); tx.setGasOwner(owner); tx.setGasPrice(1); tx.setGasBudget(1000); tx.setExpiration({ Epoch: 6 })
  tx.setGasPayment(refs.map(row => ({ objectId: row.objectId, version: String(row.version), digest: row.digest })))
  tx.moveCall({ target: `${aid(899)}::test::observed`, arguments: [tx.pure.u64(sequence)] })
  evidence.summaryData.sequence_number = String(sequence)
  Object.assign(evidence.transactionData.V1, bcs.TransactionData.parse(await tx.build()).V1)
  evidence.rehashTransaction()
  const digest = evidence.ledger.digest as string
  const primary = refs[0], raw = bcs.Object.parse(primary.bcs.value)
  const codec = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
  const contents = codec.parse(raw.data.Move!.contents)
  raw.data.Move!.contents = codec.serialize({ ...contents, balance: BigInt(contents.balance) - 1n }).toBytes()
  raw.data.Move!.version = String(outputVersion)
  raw.previousTransaction = digest
  const output = objectRow(primary.objectId, primary.objectType, raw)
  const effects = evidence.effectsData.V2!
  effects.lamportVersion = String(outputVersion)
  effects.gasObjectIndex = 0
  if (options.failure) effects.status = { $kind: 'Failure', Failure: { error: { $kind: 'InsufficientGas', InsufficientGas: true }, command: null } }
  effects.changedObjects = refs.map((ref, index) => [ref.objectId, {
    inputState: { Exist: [[String(ref.version), ref.digest], bcs.Object.parse(ref.bcs.value).owner] },
    outputState: index === 0 ? { ObjectWrite: [output.digest, raw.owner] } : { NotExist: true },
    idOperation: index === 0 ? { None: true } : { Deleted: true },
  }]) as never
  evidence.rehashEffects()
  return { digest, checkpoint: String(sequence), input, output, evidence }
}

export function installNativeSaleGasSpends(client: SuiGrpcClient, spends: Spend[], latest?: CoinRow) {
  const ledger = client.ledgerService
  const readObject = vi.mocked(ledger.getObject).getMockImplementation()!
  const readTransaction = vi.mocked(ledger.getTransaction).getMockImplementation()!
  const readCheckpoint = vi.mocked(ledger.getCheckpoint).getMockImplementation()!
  const history = spends.flatMap(row => [row.input, row.output])
    .map(row => objectRow(row.objectId, row.objectType, bcs.Object.parse(row.bcs.value)))
  const objects = new Map(history.map(row => [`${row.objectId}:${row.version}`, row]))
  vi.mocked(ledger.getObject).mockImplementation((async (request, options) => {
    const row = request.version === undefined
      ? latest?.objectId === request.objectId ? latest : undefined
      : objects.get(`${request.objectId}:${request.version}`)
    return row ? { response: { object: row } } : readObject(request, options)
  }) as typeof ledger.getObject)
  vi.mocked(ledger.getTransaction).mockImplementation((async (request, options) => {
    const row = spends.find(row => row.digest === request.digest)
    return row ? { response: { transaction: row.evidence.ledger } } : readTransaction(request, options)
  }) as typeof ledger.getTransaction)
  vi.mocked(ledger.getCheckpoint).mockImplementation((async (request, options) => {
    const selector = request.checkpointId
    const row = selector?.oneofKind === 'sequenceNumber' ? spends.find(row => BigInt(row.checkpoint) === selector.sequenceNumber) : undefined
    return row ? { response: { checkpoint: row.evidence.checkpoint } } : readCheckpoint(request, options)
  }) as typeof ledger.getCheckpoint)
}
