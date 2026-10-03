import { vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { buildCommitPrivateWalletBookmarksTx, PrivateWalletBookmarksHeadFieldV1Bcs } from '@soulidity/sdk'
import { createPrivateBookmarkTransactionAdapter, type PrivateBookmarkPublicPlan,
  type PrivateBookmarkTransactionPacket } from '../../../web/lib/bookmarks/private-bookmark-transaction'
import { privateWalletBookmarksFixture, bookmarkId, bookmarkObjectDigest } from './private-wallet-bookmarks'
import { activityEvidenceFixture, activityGenesis } from './activity-transaction-evidence'

/** Actual SDK build + local Ed25519 signing + complete Object/effects/checkpoint
 * commitments. Only transport, gas selection and ledger history are controlled;
 * this is not user-wallet signing, VM execution or validator quorum evidence. */
export async function privateBookmarkTransactionFixture(options: {
  effectsVersion?: 1 | 2; contentsVersion?: 1 | 2; expectedRevision?: string
} = {}) {
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(91)), owner = signer.toSuiAddress()
  const raw = privateWalletBookmarksFixture({ registryId: bookmarkId(42), owner })
  const history = await activityEvidenceFixture({ effectsVersion: options.effectsVersion, contentsVersion: options.contentsVersion, empty: true })
  raw.deployment.chainIdentifier = history.deployment.chainIdentifier
  raw.chain.mockResolvedValue({ chainIdentifier: activityGenesis })
  const plan: PrivateBookmarkPublicPlan = { deployment: structuredClone(raw.deployment), scope: structuredClone(raw.scope),
    expectedRevision: options.expectedRevision ?? '2', requestId: 'ff'.repeat(32), ciphertext: structuredClone(raw.ref) }
  const gas = { objectId: bookmarkId(9000), version: '4', digest: history.pkg.digest as string }
  const resolve = vi.fn(async (data: TransactionDataBuilder, _options: unknown, next: () => Promise<void>) => {
    data.inputs = data.inputs.map(input => input.UnresolvedObject
      ? Inputs.SharedObjectRef({ objectId: input.UnresolvedObject.objectId, initialSharedVersion: '1', mutable: true }) : input)
    data.gasData = { owner, budget: '1000000', price: '1', payment: [gas] }
    await next()
  })
  vi.spyOn(raw.client.core, 'resolveTransactionPlugin').mockReturnValue(resolve)
  const epoch = vi.spyOn(raw.client.ledgerService, 'getEpoch').mockResolvedValue({ response: { epoch: { epoch: 5n } } } as any)
  const service = vi.spyOn(raw.client.ledgerService, 'getServiceInfo').mockImplementation(history.client.ledgerService.getServiceInfo as any)
  const getCheckpoint = vi.spyOn(raw.client.ledgerService, 'getCheckpoint').mockImplementation((async () => ({ response: {
    checkpoint: structuredClone(history.checkpoint),
  } })) as any)
  const getTransaction = vi.spyOn(raw.client.ledgerService, 'getTransaction').mockImplementation((async () => ({ response: {
    transaction: structuredClone(history.ledger),
  } })) as any)
  const execute = vi.spyOn(raw.client.core, 'executeTransaction').mockResolvedValue({} as any)
  let address: string | null = owner
  const getAddress = vi.fn(() => address), lifetime = new AbortController()
  const sign = vi.fn(async (transaction: Transaction) => signer.signTransaction(await transaction.build()))
  const preflight = vi.fn(async (_plan: PrivateBookmarkPublicPlan, _signing: boolean) => {})
  const adapter = createPrivateBookmarkTransactionAdapter({ client: raw.client, signal: lifetime.signal, getAddress, sign, preflight })
  async function packetFor(input = plan, mutate?: (data: TransactionDataBuilder) => void): Promise<PrivateBookmarkTransactionPacket> {
    const tx = buildCommitPrivateWalletBookmarksTx(input)
    tx.setSender(input.scope.owner); tx.setExpiration({ Epoch: '6' })
    const built = await tx.build({ client: raw.client }), data = new TransactionDataBuilder(Transaction.from(built).getData())
    mutate?.(data)
    const bytes = data.build(), signed = await signer.signTransaction(bytes)
    return { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '6',
      phase: 'SIGNED', signature: signed.signature }
  }
  const packet = await packetFor()
  history.transactionData.V1 = bcs.TransactionData.parse(fromBase64(packet.bytes)).V1
  history.rehashTransaction()
  const prior = BigInt(plan.expectedRevision), count = Number(prior > 32n ? 32n : prior)
  const before = structuredClone(raw.head)
  before.revision = String(prior)
  before.receipts = Array.from({ length: count }, (_, index) => ({ request_id: Array(32).fill(index + 1),
    revision: String(prior - BigInt(count - index - 1)), ciphertext: structuredClone(before.ciphertext) }))
  const after = structuredClone(before)
  after.revision = String(prior + 1n)
  after.receipts = [...before.receipts.slice(-31), { request_id: Array(32).fill(255), revision: after.revision,
    ciphertext: structuredClone(after.ciphertext) }]
  const beforeVersion = '6', afterVersion = '7'
  const historicalRows = new Map<string, any>(), historicalObjects = new Map<string, ReturnType<typeof bcs.Object.parse>>()
  const headChange = () => history.effectsData.V2!.changedObjects.find(([id]) => id === raw.headFieldId)![1]
  const afterRef = () => [...history.effectsData.V1!.created, ...history.effectsData.V1!.mutated].find(([ref]) => ref.objectId === raw.headFieldId)![0]
  function writeHistorical(which: 'before' | 'after') {
    const version = which === 'before' ? beforeVersion : afterVersion, key = `${raw.headFieldId}@${version}`
    const object = historicalObjects.get(key)!
    const bytes = bcs.Object.serialize(object).toBytes()
    const row = { objectId: raw.headFieldId, version: BigInt(version), digest: bookmarkObjectDigest(bytes), bcs: { value: bytes } }
    historicalRows.set(key, row)
    return row
  }
  function putHistorical(which: 'before' | 'after') {
    const value = which === 'before' ? before : after, version = which === 'before' ? beforeVersion : afterVersion
    const object = structuredClone(raw.objects.get(raw.headFieldId)!)
    object.data.Move!.version = version
    object.data.Move!.contents = PrivateWalletBookmarksHeadFieldV1Bcs.serialize({ ...raw.headField, value }).toBytes()
    object.previousTransaction = which === 'after' ? packet.digest : gas.digest
    historicalObjects.set(`${raw.headFieldId}@${version}`, object)
    return writeHistorical(which)
  }
  const beforeRow = prior ? putHistorical('before') : null, afterRow = putHistorical('after')
  const ownerValue = bcs.Owner.parse(bcs.Owner.serialize({ ObjectOwner: plan.scope.registryId }).toBytes())
  if (history.effectsData.V2) {
    history.effectsData.V2.lamportVersion = afterVersion
    history.effectsData.V2.changedObjects = [[raw.headFieldId, {
      inputState: beforeRow ? { Exist: [[beforeVersion, beforeRow.digest], ownerValue], $kind: 'Exist' }
        : { NotExist: true, $kind: 'NotExist' },
      outputState: { ObjectWrite: [afterRow.digest, ownerValue], $kind: 'ObjectWrite' },
      idOperation: beforeRow ? { None: true, $kind: 'None' } : { Created: true, $kind: 'Created' },
    }]]
  } else {
    const effects = history.effectsData.V1!
    const ref = { objectId: raw.headFieldId, version: afterVersion, digest: afterRow.digest }
    effects.created = beforeRow ? [] : [[ref, ownerValue]]
    effects.mutated = beforeRow ? [[ref, ownerValue]] : []
    effects.modifiedAtVersions = beforeRow ? [[raw.headFieldId, beforeVersion]] : []
  }
  history.rehashEffects()
  function rehashHistorical(which: 'before' | 'after') {
    const row = writeHistorical(which)
    if (history.effectsData.V2) {
      if (which === 'after') headChange().outputState.ObjectWrite![0] = row.digest
      else headChange().inputState.Exist![0][1] = row.digest
    } else if (which === 'after') afterRef().digest = row.digest
    history.rehashEffects()
  }
  function rewriteHead(which: 'before' | 'after', mutate: (value: ReturnType<typeof PrivateWalletBookmarksHeadFieldV1Bcs.parse>) => void) {
    const key = `${raw.headFieldId}@${which === 'before' ? beforeVersion : afterVersion}`, object = historicalObjects.get(key)!
    const value = PrivateWalletBookmarksHeadFieldV1Bcs.parse(object.data.Move!.contents)
    mutate(value); object.data.Move!.contents = PrivateWalletBookmarksHeadFieldV1Bcs.serialize(value).toBytes()
    rehashHistorical(which)
  }
  const baseGet = raw.get.getMockImplementation()!
  raw.get.mockImplementation(((request: any, opts: any) => request.version === undefined ? baseGet(request, opts)
    : Promise.resolve({ response: { object: structuredClone(historicalRows.get(`${request.objectId}@${request.version}`)) } })) as any)
  function installCurrent(value: 'before' | 'after' | null) {
    if (value === null || value === 'before' && !prior) raw.rows.delete(raw.headFieldId)
    else { Object.assign(raw.head, structuredClone(value === 'before' ? before : after)); raw.putHead() }
  }
  installCurrent('after')
  return { raw, history, signer, owner, plan, packet, packetFor, gas, resolve, epoch, service, getCheckpoint, getTransaction,
    execute, getAddress, lifetime, sign, preflight, adapter, before, after, beforeVersion, afterVersion,
    historicalRows, historicalObjects, headChange, afterRef, rehashHistorical, rewriteHead, installCurrent,
    setAddress: (value: string | null) => { address = value } }
}
