import { afterEach, expect, it, vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase58, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { SealClient } from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'
import { moveEmptyStructBytes, MoveEmptyStructBcs } from '../../web/lib/sui/move-empty-struct'
import { CanonicalNativeLibraryBcs, CanonicalNativeRecordBcs, CanonicalNativeStateBcs } from '../../web/lib/soulidity/canonical-native-workbench'
import { openCanonicalNativeContent } from '../../web/lib/soulidity/canonical-native-content-open'
import { encryptNativeCreationEnvelope } from '../../web/lib/soulidity/native-creation-envelope'
import { verifyNativeSaleLifecycle } from '../../web/lib/soulidity/commerce/native-sale-lifecycle'
import { aid } from './fixtures/activity-transaction-evidence'
import { nativeSaleLifecycleWireFixture, objectRow } from './fixtures/commerce-native-sale-lifecycle-wire'
import { contentAppendPreparationFixture } from './fixtures/content-append-preparation'

afterEach(() => vi.restoreAllMocks())

async function fixture(withCollection = false) {
  const wallet = await contentAppendPreparationFixture()
  const buyer = wallet.signer.toSuiAddress()
  const sale = await nativeSaleLifecycleWireFixture('', withCollection, buyer)
  const { review, plan, purchaseRows } = sale
  const saleEvidence = await verifyNativeSaleLifecycle({ ...sale, client: sale.client as never })
  if (saleEvidence.status !== 'NATIVE_SALE_LIFECYCLE_CONFIRMED') throw Error('Fixture sale not confirmed')
  const target = review.target
  const native = target.native.originalPackageId, standard = target.standard.originalPackageId
  const content = target.content!.originalPackageId, custody = target.custody!.originalPackageId
  const state = CanonicalNativeStateBcs.parse(purchaseRows.get(`${sale.stateId}:10`)!.contents.value)
  const latest = new Map([...purchaseRows.values()].filter(row => row.version === 10n).map(row => [row.objectId, row]))
  const material = new Uint8Array(32).fill(3), iv = new Uint8Array(12).fill(4)
  const seal = new SealClient({ suiClient: wallet.client, serverConfigs: wallet.params.sealConfig.serverConfigs, verifyKeyServers: true })
  const plaintext = wallet.params.plaintext
  const key = await crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))
  const nonce = '12'.repeat(16)
  const envelope = await encryptNativeCreationEnvelope({ sealPackageId: native, contentId: state.content, kind: 0, name: 'soul', nonce,
    contentHash: toHex(sha256(plaintext)), fileName: 'soul.md', mimeType: 'text/markdown', dek: material, iv,
    config: wallet.params.sealConfig, signal: wallet.controller.signal, encrypt: seal.encrypt.bind(seal) })
  material.fill(0)
  const record = CanonicalNativeRecordBcs.serialize({ kind: 0, name: 'soul', version: 0,
    reference: { object: aid(520), blob_id: '1', sha256: sha256(ciphertext), bytes: ciphertext.length, certified_epoch: 4, end_epoch: 9 },
    read_mask: 3, op_mask: 6, scope: 1, download_policy: 1, nonce: Uint8Array.from({ length: 16 }, () => 0x12),
    envelope: new TextEncoder().encode(JSON.stringify(envelope)), deleted: false, purged: false, created_at_ms: 100, seal_namespace: null }).toBytes()
  const name = new TextEncoder().encode('native')
  const stateKey = `0x2::dynamic_object_field::Wrapper<${standard}::soul::ModuleKey<${native}::birth::NativeModule>>`
  const stateField = deriveDynamicFieldID(review.soulId, stateKey, bcs.byteVector().serialize(name).toBytes())
  const libraryKey = `0x2::dynamic_object_field::Wrapper<${native}::birth::ContentKey>`
  const libraryField = deriveDynamicFieldID(state.id, libraryKey, moveEmptyStructBytes())
  const A = bcs.Address, uidTable = { id: aid(521), size: 1 }
  const stateFieldBcs = bcs.struct('Field', { id: A, name: bcs.struct('Wrapper', {
    name: bcs.struct('ModuleKey', { name: bcs.byteVector() }),
  }), value: A })
  const contentFieldBcs = bcs.struct('Field', { id: A, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: A })
  const recordFieldBcs = bcs.struct('Field', { id: A, name: bcs.u64(), value: CanonicalNativeRecordBcs })
  function install(id: string, type: string, parent: string, contents: Uint8Array) {
    const row = objectRow(id, type, { data: { Move: { type: { Other: TypeTagSerializer.parseFromStr(type).struct! },
      hasPublicTransfer: true, version: 7, contents } }, owner: { ObjectOwner: parent }, previousTransaction: sale.setupDigest, storageRebate: 0 })
    latest.set(id, row)
  }
  install(stateField, `0x2::dynamic_field::Field<${stateKey},0x2::object::ID>`, review.soulId,
    stateFieldBcs.serialize({ id: stateField, name: { name: { name } }, value: state.id }).toBytes())
  install(libraryField, `0x2::dynamic_field::Field<${libraryKey},0x2::object::ID>`, state.id,
    contentFieldBcs.serialize({ id: libraryField, name: { name: { dummy_field: false } }, value: state.content }).toBytes())
  install(state.content, `${content}::founding_library::Library`, libraryField,
    CanonicalNativeLibraryBcs.serialize({ id: state.content, root: review.soulId,
      controller: { operator: { name: `${native}::birth::ContentOperator` }, parent: state.id, root: review.soulId },
      revision: 1, records: uidTable, counts: { id: aid(522), size: 1 }, indices: { id: aid(523), size: 1 },
      active: { id: aid(524), size: 0 }, entries: [{ index: 0, hash: sha256(record) }] }).toBytes())
  const field = deriveDynamicFieldID(uidTable.id, 'u64', bcs.u64().serialize(0).toBytes())
  install(field, `0x2::dynamic_field::Field<u64,${content}::document::Record>`, uidTable.id,
    recordFieldBcs.serialize({ id: field, name: 0, value: CanonicalNativeRecordBcs.parse(record) }).toBytes())

  const { client } = wallet
  const getObject = vi.spyOn(client.ledgerService, 'getObject').mockImplementation(async ({ objectId }) =>
    latest.has(objectId!) ? { response: { object: latest.get(objectId!) } } as never : sale.client.ledgerService.getObject({ objectId: objectId! }) as never)
  vi.spyOn(client.core, 'listOwnedObjects').mockImplementation(async ({ owner }) => ({
    objects: owner === buyer ? [{ objectId: plan.buyerAccount.objectId }] : [], hasNextPage: false, cursor: null,
  }) as never)
  vi.spyOn(client.core, 'getObjects').mockImplementation(async ({ objectIds }) => ({
    objects: objectIds.map(id => ({ objectId: id, version: '10', digest: latest.get(id)!.digest,
      owner: id === plan.buyerKioskId ? { $kind: 'Shared', Shared: { initialSharedVersion: '1' } }
        : { $kind: 'AddressOwner', AddressOwner: buyer } })),
  }) as never)
  const dt = (typeName: string, reference: 'mutable' | 'immutable' | null = null) =>
    ({ reference, body: { $kind: 'datatype', datatype: { typeName: normalizeStructTag(typeName), typeParameters: [] } } })
  vi.mocked(client.core.getMoveFunction).mockResolvedValue({ function: {
    packageId: target.native.callablePackageId, moduleName: 'birth', name: 'seal_approve_content_owner', visibility: 'public',
    typeParameters: [], returns: [], parameters: [{ reference: null, body: { $kind: 'vector', vector: { $kind: 'u8' } } },
      dt('0x2::kiosk::Kiosk', 'mutable'), dt(`${custody}::account::Account`, 'immutable'), dt('0x2::object::ID'),
      { reference: null, body: { $kind: 'u64' } }, dt('0x2::tx_context::TxContext', 'immutable')],
  } } as never)
  const fetcher = vi.fn(async () => new Response(new Uint8Array(ciphertext)))
  const input = { client, sealClient: client, target, soulId: review.soulId, recordIndex: 0, viewerAddress: buyer,
    expectedRecord: { version: '0', ciphertextHash: toHex(sha256(ciphertext)) }, blobBaseUrl: 'https://walrus.example.com',
    sealConfig: wallet.params.sealConfig, signal: wallet.controller.signal,
    getAddress: wallet.params.wallet.getAddress, signPersonalMessage: wallet.sign }
  return { sale, saleEvidence, wallet, getObject, fetcher, input, plaintext }
}

it.each([false, true])('opens the same purchased Soul using current BCS, real Seal cryptography and the buyer signature (Collection %s)', async withCollection => {
  const f = await fixture(withCollection)
  const result = await openCanonicalNativeContent(f.input, { fetcher: f.fetcher })
  try {
    expect(result.bytes).toEqual(f.plaintext)
    expect(f.wallet.sign).toHaveBeenCalledOnce()
    expect(f.saleEvidence.sale.receipt.custody?.buyerAccountId).toBe(f.sale.plan.buyerAccount.objectId)
    const tx = bcs.TransactionKind.parse(f.wallet.decryptCall.mock.calls[0][0].txBytes).ProgrammableTransaction!
    expect(tx.commands).toHaveLength(1)
    expect(tx.commands[0].MoveCall?.function).toBe('seal_approve_content_owner')
    expect(tx.inputs[1].Object?.SharedObject?.objectId).toBe(f.sale.plan.buyerKioskId)
    expect(tx.inputs[2].Object?.ImmOrOwnedObject?.objectId).toBe(f.sale.plan.buyerAccount.objectId)
  } finally { result.bytes.fill(0) }
})

it('refuses the prior seller before ciphertext fetching or a wallet prompt', async () => {
  const f = await fixture(), seller = f.sale.review.seller
  await expect(openCanonicalNativeContent({ ...f.input, viewerAddress: seller, getAddress: () => seller },
    { fetcher: f.fetcher })).rejects.toThrow('OWNER_RECORD_REQUIRED')
  expect(f.wallet.sign).not.toHaveBeenCalled()
  expect(f.fetcher).not.toHaveBeenCalled()
})

it('rejects a network with the same four-byte identifier but a different genesis', async () => {
  const f = await fixture()
  const fake = fromBase58(MAINNET_GENESIS_DIGEST)
  fake[fake.length - 1] ^= 1
  vi.mocked(f.wallet.client.core.getChainIdentifier).mockResolvedValueOnce({ chainIdentifier: toBase58(fake) })
  await expect(openCanonicalNativeContent(f.input, { fetcher: f.fetcher })).rejects.toThrow('NATIVE_WORKBENCH_WRONG_CHAIN')
  expect(f.getObject).not.toHaveBeenCalled()
  expect(f.wallet.sign).not.toHaveBeenCalled()
})
