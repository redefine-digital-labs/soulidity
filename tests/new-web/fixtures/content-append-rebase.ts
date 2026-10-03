import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import { sha256Hex } from '../../../web/lib/upload/client-seal'
import { parseWalrusSingleRecord, type WalrusSingleRecord } from '../../../web/lib/upload/walrus-single-operation'
import { contentAppendWalrusIntent, parseContentAppendIntent, type ContentAppendIntent } from '../../../web/lib/soulidity/content-append-operation'
import { prepareContentAppend, rewrapContentAppendPreparation, contentAppendPreparationFingerprint,
  type ContentAppendPreparation } from '../../../web/lib/soulidity/content-append-preparation'
import { compactContentAppendPreparation, contentAppendStorageRootHash, seedContentAppendRebasePayment,
  verifyContentAppendRebaseLink, type ContentAppendRebaseLink } from '../../../web/lib/soulidity/content-append-rebase-evidence'
import { contentAppendPreparationFixture, contentAppendFixtureId as id } from './content-append-preparation'

// Actual local Seal/AES and Ed25519 signatures; OFFLINE payment/inspection only.
// No live registration, storage quorum, chain retirement or wallet approval.
export async function contentAppendRebaseFixture(options: { grant?: boolean; autoGrant?: boolean; autoGrantScopeMask?: number } = {}) {
  const f = await contentAppendPreparationFixture()
  const intent: ContentAppendIntent = { schema: 'soulidity.content-append-intent.v1', rebase: null,
    soulId: id(2), stateId: id(3), kindRegistryId: id(5), marketConfigId: id(6), ownershipEpoch: '0',
    grantId: options.grant ? id(7) : null, readModeMask: 1, downloadPolicy: 'owner_only',
    spriteConfigJson: null, setActive: false,
    autoGrantPlan: options.autoGrant ? { capacityBefore: '1', capacityAfter: '2', targets: [{ address: id(8), scopeMask: options.autoGrantScopeMask ?? 1 }] } : null,
    contentHash: await sha256Hex(f.params.plaintext), plaintextByteLength: f.params.plaintext.length,
    fileName: f.params.fileName, mimeType: f.params.mimeType,
    uploadConfig: { network: 'mainnet', relayUrl: 'https://relay.example.com', wasmUrl: '/walrus/walrus_wasm@0.0.2.wasm', storageEpochs: 3 } }
  const scope = { ...f.params.scope, versionIndex: '2', intentJson: JSON.stringify(intent) }
  const previous = await prepareContentAppend({ ...f.params, scope })
  async function packet(n: number) {
    const tx = new Transaction()
    tx.setSender(scope.author); tx.setGasOwner(scope.author); tx.setGasBudget(1000000); tx.setGasPrice(1)
    tx.setGasPayment([{ objectId: id(90), version: '1', digest: toBase58(new Uint8Array(32).fill(3)) }])
    tx.setExpiration({ Epoch: 12 }); tx.moveCall({ target: `${id(20)}::fixture::evidence`, arguments: [tx.pure.u8(n)] })
    const bytes = await tx.build(), signed = await f.signer.signTransaction(bytes)
    return { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes),
      expirationEpoch: '12', signature: signed.signature, phase: 'SUCCEEDED' as const }
  }
  const previousPayment: WalrusSingleRecord = parseWalrusSingleRecord({ schema: 'soulidity.walrus-single.v1',
    intent: contentAppendWalrusIntent(previous),
    encoding: { blobId: 'offline-blob-id', rootHash: 'offline-root-hash', nonce: 'original-relay-nonce', unencodedSize: previous.ciphertext.length },
    approved: { relayTip: '1', storageCost: '3', writeCost: '2', gasBudget: '1000000', quoteId: 'original-paid-quote' },
    register: await packet(1), certify: null, acknowledged: false,
    uploaded: { blobId: 'offline-blob-id', blobObjectId: id(100), certificate: 'offline-certificate' } })
  const rebase: NonNullable<ContentAppendIntent['rebase']> = { nonce: 'ab'.repeat(16),
    predecessor: contentAppendPreparationFingerprint(previous), storageRootHash: contentAppendStorageRootHash(previousPayment),
    certifyGasBudgetMist: '700000', autoGrantTargets: structuredClone(intent.autoGrantPlan?.targets ?? []) }
  async function nextRecord(change: Partial<ContentAppendIntent> = {}, versionIndex = '3') {
    return rewrapContentAppendPreparation({ record: previous,
      nextScope: { ...scope, versionIndex, intentJson: JSON.stringify({ ...intent, rebase, ...change }) },
      sealConfig: f.params.sealConfig, wallet: f.params.wallet })
  }
  const next = await nextRecord()
  function linkFor(record: ContentAppendPreparation = next): ContentAppendRebaseLink {
    return { schema: 'soulidity.content-append-rebase.v1', previous: compactContentAppendPreparation(previous),
      previousPayment: structuredClone(previousPayment), next: compactContentAppendPreparation(record),
      nextPayment: seedContentAppendRebasePayment(record, previousPayment),
      inspection: { blobObjectId: id(100), blobVersion: '2', blobDigest: toBase58(new Uint8Array(32).fill(4)),
        observedWalrusEpoch: 9, storageEndEpoch: 15,
        retirement: { kind: 'NO_RECORDED_PACKET', digest: null, observedSuiEpoch: null } } }
  }
  const link = linkFor()
  let attempt = 0
  /** Build another real signed edge from any fixture-owned predecessor. Use
   * result.record/payment as the next call's inputs to construct a history. */
  async function advance(record = next, payment = link.nextPayment,
    change: Partial<ContentAppendIntent> = {}, versionIndex = String(BigInt(record.scope.versionIndex) + 1n)) {
    const before = parseContentAppendIntent(record)
    const intent: ContentAppendIntent = { ...before, rebase: {
      nonce: (++attempt).toString(16).padStart(32, '0'), predecessor: contentAppendPreparationFingerprint(record),
      storageRootHash: contentAppendStorageRootHash(payment), certifyGasBudgetMist: '800000',
      autoGrantTargets: structuredClone(before.rebase?.autoGrantTargets ?? before.autoGrantPlan?.targets ?? []) }, ...change }
    const after = await rewrapContentAppendPreparation({ record,
      nextScope: { ...record.scope, versionIndex, intentJson: JSON.stringify(intent) },
      sealConfig: f.params.sealConfig, wallet: f.params.wallet })
    const nextPayment = seedContentAppendRebasePayment(after, payment)
    const edge: ContentAppendRebaseLink = { schema: 'soulidity.content-append-rebase.v1',
      previous: compactContentAppendPreparation(record), previousPayment: structuredClone(payment),
      next: compactContentAppendPreparation(after), nextPayment,
      inspection: structuredClone(link.inspection) }
    return { record: after, payment: nextPayment, link: edge }
  }
  const verify = (value: ContentAppendRebaseLink = link, ciphertext = previous.ciphertext) => verifyContentAppendRebaseLink(value, ciphertext, f.client)
  return { ...f, intent, scope, previous, next, previousPayment, rebase, nextRecord, linkFor, link, verify, packet, advance }
}
