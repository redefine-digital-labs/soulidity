import { vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { buildSavePrivateNamedLoadoutTx, buildUpdatePrivateNamedLoadoutTx } from '../../../packages/soulidity-sdk/src/private-named-loadout'
import { createPrivateLoadoutTransactionAdapter, type PrivateLoadoutPublicPlan,
  type PrivateLoadoutTransactionPacket } from '../../../web/lib/animacraft/private-loadout-transaction'
import { privateNamedLoadoutFixture, privateId, privateDigest } from './private-named-loadout'

export const privateTransactionSigner = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(17))
export async function privateLoadoutTransactionFixture(save = false, first = false) {
  const f = privateNamedLoadoutFixture(), owner = privateTransactionSigner.toSuiAddress()
  f.scope.owner = owner; f.state.current_owner = owner; f.head.owner = owner; f.putState()
  f.head.receipts[1].capture = save ? structuredClone(f.head.receipts[0].capture) : null
  if (first) { f.head.revision = '1'; f.head.receipts = [f.head.receipts[1]]; f.head.receipts[0].revision = '1' }
  f.putHead()
  const plan: PrivateLoadoutPublicPlan = { deployment: f.deployment, scope: f.scope, expectedRevision: first ? '0' : '1',
    requestId: '02'.repeat(32), ciphertext: f.ref, capture: save ? f.capture : null, protocolId: privateId(21) }
  const base = save ? buildSavePrivateNamedLoadoutTx({ ...plan, capture: plan.capture! }) : buildUpdatePrivateNamedLoadoutTx(plan)
  const data = base.getData()
  const resolve = (input: any) => input.UnresolvedObject ? Inputs.SharedObjectRef({ objectId: input.UnresolvedObject.objectId,
    initialSharedVersion: '1', mutable: input.UnresolvedObject.objectId === plan.scope.stateId }) : input
  const tx = Transaction.from(JSON.stringify({ ...data, inputs: data.inputs.map(resolve) }))
  tx.setSender(owner); tx.setGasOwner(owner); tx.setGasPrice('1000'); tx.setGasBudget('1000000')
  tx.setGasPayment([{ objectId: privateId(99), version: '1', digest: privateDigest }]); tx.setExpiration({ Epoch: '10' })
  const bytes = await tx.build()
  const packet: PrivateLoadoutTransactionPacket = { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes),
    expirationEpoch: '10', phase: 'PREPARED', signature: null }
  const history = new Map([...f.rows].map(([id, row]) => [id, structuredClone(row)]))
  f.get.mockImplementation(((request: any) => Promise.resolve({ response: {
    object: structuredClone((request.version === undefined ? f.rows : history).get(request.objectId)) } })) as any)
  const change = (objectId: string, owner: any) => [objectId, {
    inputState: { Exist: [['2', privateDigest], owner] }, outputState: { ObjectWrite: [privateDigest, owner] }, idOperation: { None: true },
  }]
  const effects: any = { V2: { status: { Success: true }, executedEpoch: '9',
    gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' }, transactionDigest: packet.digest,
    gasObjectIndex: null, eventsDigest: null, dependencies: [], lamportVersion: '3',
    changedObjects: [change(f.scope.stateId, { Shared: { initialSharedVersion: '1' } }), change(f.headFieldId, { ObjectOwner: f.scope.stateId })],
    unchangedConsensusObjects: [], auxDataDigest: null } }
  const ledger: any = { digest: packet.digest, transaction: { digest: packet.digest, bcs: { value: bytes } },
    effects: { transactionDigest: packet.digest, bcs: { value: bcs.TransactionEffects.serialize(effects).toBytes() }, status: { success: true } }, checkpoint: 0n }
  const refreshEffects = () => { ledger.effects.bcs.value = bcs.TransactionEffects.serialize(effects).toBytes() }
  const getTransaction = vi.spyOn(f.client.ledgerService, 'getTransaction').mockImplementation((async () => ({ response: { transaction: ledger } })) as any)
  const getEpoch = vi.spyOn(f.client.ledgerService, 'getEpoch').mockImplementation((async () => ({ response: { epoch: { epoch: 9n } } })) as any)
  const resolver = vi.spyOn(f.client.core, 'resolveTransactionPlugin').mockImplementation(() => async (builder: any, _options: any, next: () => Promise<void>) => {
    builder.inputs = builder.inputs.map(resolve); builder.gasData = tx.getData().gasData; await next()
  })
  const execute = vi.spyOn(f.client.core, 'executeTransaction').mockResolvedValue({} as any)
  let address: string | null = owner
  const preflight = vi.fn(async (_plan: PrivateLoadoutPublicPlan, _signing: boolean) => {})
  const sign = vi.fn(async (transaction: Transaction) => privateTransactionSigner.signTransaction(await transaction.build()))
  const adapter = createPrivateLoadoutTransactionAdapter({ client: f.client, getAddress: () => address, sign, preflight })
  return { ...f, plan, packet, tx, bytes, history, effects, ledger, refreshEffects, getTransaction, getEpoch, resolver, execute,
    preflight, sign, adapter, setAddress(value: string | null) { address = value },
    query: () => adapter.query(plan, packet),
    async signed() { const signed = await privateTransactionSigner.signTransaction(fromBase64(packet.bytes))
      return { ...packet, phase: 'SIGNED' as const, signature: signed.signature } },
  }
}

export function rewritePrivateTransactionPacket(packet: PrivateLoadoutTransactionPacket, mutate: (raw: any) => void) {
  const raw = bcs.TransactionData.parse(fromBase64(packet.bytes)); mutate(raw)
  const bytes = bcs.TransactionData.serialize(raw).toBytes()
  return { ...packet, bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes) }
}
