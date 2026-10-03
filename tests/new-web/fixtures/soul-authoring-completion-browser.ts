import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import { SOUL_PUBLIC_USDC_TYPE } from '@soulidity/sdk'
import { soulAuthoringUploadScope, type SoulAuthoringRequest } from '../../../web/lib/soulidity/soul-authoring-manifest'
import { prepareWalrusBatch, walrusBatchPreparationHash } from '../../../web/lib/upload/walrus-batch-preparation'
import { browserSoulAuthoringStore, soulAuthoringStoreKey, type SoulAuthoringPreparation } from '../../../web/lib/soulidity/soul-authoring-store'
import { browserSoulAuthoringPacketJournal } from '../../../web/lib/soulidity/soul-authoring-journal'
import { soulAuthoringPlan } from '../../../web/lib/soulidity/soul-authoring-runner'
import { archiveCompletedSoulAuthoring, readSoulAuthoringCompletion } from '../../../web/lib/soulidity/soul-authoring-completion'
import { setPending } from './soul-authoring-completion-storage-proof'

// Isolated localhost origin, synthetic zero-file packets, no wallet or network.
const id = (n: number) => '0x' + n.toString(16).padStart(64, '0')
const output = document.querySelector('pre')!
const check = (value: unknown, message: string) => { if (!value) throw Error(message) }
async function setup(operation: number) {
  const author = id(80), request: SoulAuthoringRequest = {
    schema: 'soulidity.soul-authoring-request.v1', author, operationId: operation.toString(16).padStart(32, '0'), storageEpochs: 1,
    target: { chainIdentifier: '35834a8a', originalPackageId: id(1), callablePackageId: id(2), callableDigest: toBase58(new Uint8Array(32).fill(7)),
      marketConfigId: id(3), kioskRegistryId: id(4), personalKioskTypePackageId: id(5), paymentCoinType: SOUL_PUBLIC_USDC_TYPE,
      collectionTransferPolicyId: id(6), kioskPackageId: id(7), kindRegistryId: id(8), soulTransferPolicyId: id(9), blobBaseUrl: 'https://aggregator.example' },
    collection: { name: 'Storage fixture', description: 'Not a real chain receipt', image: { kind: 'URL', url: 'https://example.com/cover.png' },
      extraRoyaltyBps: 0, tradeable: true, maxSupply: null, floorPriceAtomic: null, listingPriceAtomic: null }, bindCollectionId: null, mints: [],
  }
  const lifetime = { signal: new AbortController().signal, getAddress: () => author, isCurrent: () => true }
  const preparation = await prepareWalrusBatch({ scope: soulAuthoringUploadScope(request), files: [], storageEpochs: 1,
    client: {} as never, lifetime, protector: null })
  const p: SoulAuthoringPreparation = { schema: 'soulidity.soul-authoring-preparation.v1', preparation,
    manifest: { schema: 'soulidity.soul-authoring-manifest.v1', request, preparationHash: walrusBatchPreparationHash(preparation), sealContext: null, sidecars: [] } }
  const store = browserSoulAuthoringStore(), key = soulAuthoringStoreKey(request)
  await store.exclusive(key, () => store.create(key, p))
  const tx = new Transaction(); tx.setSender(author); tx.setGasOwner(author); tx.setGasBudget(1000 + operation); tx.setGasPrice(1)
  tx.setGasPayment([{ objectId: id(90), version: '1', digest: toBase58(new Uint8Array(32).fill(2)) }]); tx.setExpiration({ Epoch: '10' })
  const bytes = TransactionDataBuilder.restore(tx.getData()).build(), digest = TransactionDataBuilder.getDigestFromBytes(bytes)
  const journal = browserSoulAuthoringPacketJournal(p), packetKey = `${key}:packets`
  await journal.exclusive(packetKey, () => journal.write(packetKey, { schema: 'soulidity.soul-authoring-packet.v1',
    plan: soulAuthoringPlan(p, { kind: 'REGISTER', kiosk: { kind: 'NEW', kioskId: null, capId: null } }),
    packet: { bytes: toBase64(bytes), digest, expirationEpoch: '10', phase: 'PREPARED', signature: null } }))
  return { p, key, store, journal, packetKey, archive: () => archiveCompletedSoulAuthoring({
    client: {} as never, preparation: p, expectedDigest: digest, lifetime }) }
}
document.querySelector('button')!.onclick = async event => {
  const button = event.currentTarget as HTMLButtonElement; button.disabled = true
  const lines: string[] = []
  try {
    const a = await setup(1)
    setPending(true)
    try { await a.archive(); throw Error('Unknown completion was accepted') } catch (e) {
      check(String(e).includes('UNRESOLVED_PACKET'), String(e))
    }
    check(await a.store.read(a.key), 'Unknown packet lost active record'); setPending(false)
    lines.push('PASS: unknown packet retains active creation')
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'archive') throw new DOMException('fixture disk full', 'QuotaExceededError')
      return put.apply(this, args)
    }
    try { await a.archive(); throw Error('Storage failure was accepted') } catch (e) {
      check(String(e).includes('fixture disk full'), String(e))
    } finally { IDBObjectStore.prototype.put = put }
    check(await a.store.read(a.key) && await a.journal.read(a.packetKey), 'Aborted move lost active records')
    lines.push('PASS: archive write failure atomically retains parent/upload/packet')
    const get = IDBObjectStore.prototype.get; let archiveReads = 0
    IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore['get']>) {
      if (this.name === 'archive' && ++archiveReads === 3) throw Error('fixture readback unavailable')
      return get.apply(this, args)
    }
    try { await a.archive(); throw Error('Missing readback was accepted') } catch (e) {
      check(String(e).includes('fixture readback unavailable'), String(e))
    } finally { IDBObjectStore.prototype.get = get }
    check(await a.store.read(a.key) === null, 'Completed move should already be committed')
    lines.push('PASS: commit can survive a lost readback without recreating the active operation')
    const archiveKey = await a.archive(), saved = await readSoulAuthoringCompletion(archiveKey)
    check(saved?.upload.registration && saved.head.packet.digest, 'Completed proof was not retained')
    check(await a.store.read(a.key) === null, 'Completed lane was not released')
    lines.push('PASS: completion proof retained and active lane released')
    const b = await setup(2)
    check((await b.store.read(b.key))?.manifest.request.operationId === b.p.manifest.request.operationId, 'Second creation failed')
    check(await a.archive() === archiveKey, 'Old completed operation is not idempotent')
    check((await b.store.read(b.key))?.manifest.request.operationId === b.p.manifest.request.operationId, 'Old retry removed second creation')
    lines.push('PASS: second creation works; old archival retry cannot remove it')
    await b.archive()
    output.textContent = lines.join('\n') + '\n5/5 PASS — storage-only controlled proof; no wallet/network acceptance'
  } catch (error) { output.textContent = lines.join('\n') + '\nFAIL: ' + String(error) }
}
