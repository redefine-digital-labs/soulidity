import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase64, toBase58 } from '@mysten/sui/utils'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { bcs } from '@mysten/sui/bcs'
import { blake2b } from '@noble/hashes/blake2.js'
import { buildMarketCancelOperationTransaction, type MarketCancelOperationRecord, type MarketCancelSnapshot } from '../../../web/lib/animacraft/market-cancel-operation'
import { MarketCancelCheckpointSummaryBcs, marketCancelCheckpointDigest } from '../../../web/lib/animacraft/market-cancel-checkpoint'
export const cid = (n: number) => `0x${n.toString(16).padStart(64,'0')}`
export const cancelSigner = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(19))
export function marketCancelCheckpointFixture(epoch='11', sequenceNumber='100', endOfEpoch=false) {
  const digest = Array(32).fill(7)
  const summary = { epoch,sequence_number:sequenceNumber,network_total_transactions:'900',content_digest:digest,
    previous_digest:digest,epoch_rolling_gas_cost_summary:{computation_cost:'1',storage_cost:'2',storage_rebate:'3',non_refundable_storage_fee:'4'},
    timestamp_ms:'1700000000000',checkpoint_commitments:[{CheckpointArtifactsDigest:digest}],
    end_of_epoch_data:endOfEpoch?{next_epoch_committee:[[Array(96).fill(3),'100'] as [number[],string]],next_epoch_protocol_version:'128',epoch_commitments:[{ECMHLiveObjectSetDigest:digest}]}:null,
    version_specific_data:[1,2,3] }
  const bytes=MarketCancelCheckpointSummaryBcs.serialize(summary).toBytes()
  const evidence={bytes:toBase64(bytes),digest:marketCancelCheckpointDigest(bytes),epoch,sequenceNumber}
  return {evidence,summary,bytes,checkpoint:{sequenceNumber:BigInt(sequenceNumber),digest:evidence.digest,
    summary:{bcs:{value:bytes},digest:evidence.digest,epoch:BigInt(epoch),sequenceNumber:BigInt(sequenceNumber)},
    // Structural RPC signature fixture only, not a quorum/BLS verification claim.
    signature:{epoch:BigInt(epoch),signature:new Uint8Array(48).fill(1),bitmap:new Uint8Array([1])}}}
}
export const cancelEventBcs = bcs.struct('SoulListingCancelled', { listing_id: bcs.Address, soul_id: bcs.Address, seller: bcs.Address })
export const cancelEventsBcs = bcs.struct('TransactionEvents', { data: bcs.vector(bcs.struct('Event', {
  package_id: bcs.Address, transaction_module: bcs.string(), sender: bcs.Address, type_: bcs.StructTag, contents: bcs.vector(bcs.u8()),
})) })
export function cancelEventEvidence(record: MarketCancelOperationRecord, mutate?: (data: any) => void) {
  const data = { data: [{ package_id: record.release.soulidityCallablePackageId, transaction_module: 'market', sender: record.owner,
    type_: { address: cid(4), module: 'market', name: 'SoulListingCancelled', typeParams: [] },
    contents: Array.from(cancelEventBcs.serialize({ listing_id: record.listingId,soul_id: record.soulId,seller: record.owner }).toBytes()),
  }] }
  mutate?.(data)
  const bytes = cancelEventsBcs.serialize(data).toBytes()
  return { bcs: { value: bytes }, digest: toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('TransactionEvents::'),...bytes]), {dkLen:32})), events: [] }
}
export async function marketCancelFixture() {
  const snapshot: MarketCancelSnapshot = { schema: 'native-market-cancel-v1', soulId: cid(12), stateId: cid(14),
    bindingId: cid(13), owner: cancelSigner.toSuiAddress(), kioskId: cid(20), kioskCapId: cid(21),
    ownershipEpoch: '3', listingId: cid(22), listed: true, listingActive: true,
    release: { network: 'mainnet', protocolConfigId: cid(1), soulidityCallablePackageId: cid(5),
      soulidityCallableDigest: toBase58(new Uint8Array(32).fill(2)), writesEnabled: true } }
  const data = buildMarketCancelOperationTransaction(snapshot).getData()
  const tx = Transaction.from(JSON.stringify({ ...data, inputs: data.inputs.map(input => {
    const objectId = input.UnresolvedObject!.objectId
    return { Object: objectId === snapshot.kioskCapId
      ? { ImmOrOwnedObject: { objectId, version: '2', digest: snapshot.release.soulidityCallableDigest } }
      : { SharedObject: { objectId, initialSharedVersion: '1', mutable: true } } }
  }) }))
  tx.setSender(snapshot.owner); tx.setGasOwner(snapshot.owner); tx.setGasPrice('1000'); tx.setGasBudget('1000000')
  tx.setGasPayment([{ objectId: cid(200), version: '1', digest: snapshot.release.soulidityCallableDigest }])
  tx.setExpiration({ Epoch: '10' })
  const bytes = await tx.build()
  const { schema: _, listed: __, listingActive: ___, ...identity } = snapshot
  const record: MarketCancelOperationRecord = { ...structuredClone(identity), schema: 1, kind: 'cancel-listing',
    bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'PREPARED', signature: null }
  return { snapshot, record, bytes, tx }
}
