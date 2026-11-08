import { MoveEmptyStructBcs, moveEmptyStructBytes } from '../../../web/lib/sui/move-empty-struct'
import { deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE, SoulPublicKioskBcs } from '@soulidity/sdk'
import { vi } from 'vitest'
import { bcs, TypeTagSerializer } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, fromHex, fromBase58 } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { CanonicalSoulBcs, CanonicalNativeStateBcs, CanonicalNativeLibraryBcs, CanonicalNativeRecordBcs, CanonicalOwnedAccountBcs, readCanonicalNativeWorkbench, type CanonicalNativeWorkbenchTarget } from '../../../web/lib/soulidity/canonical-native-workbench'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'
import { activityEvidenceFixture, activityHash, aid, adigest } from './activity-transaction-evidence'
import vm from './native-creation-lifecycle-vm.json'
import { deriveNativeCreationContentId } from '../../../web/lib/soulidity/native-creation-transaction'

export async function canonicalNativeWorkbenchFixture(withContent = false, count = 2, withCustody = false, initial = false, author = vm.author) {
  const std = await activityEvidenceFixture(), native = await activityEvidenceFixture()
  const standardId = aid(40), nativeId = vm.nativeOriginalPackageId
  function pin(f: typeof std, original: string, callable: string, definitions: Array<[string, string]>) {
    f.deployment.originalPackageId = original; f.deployment.callablePackageId = callable
    const pkg = f.packageData.data.Package!; pkg.id = callable
    pkg.moduleMap = new Map([...new Set(definitions.map(([module]) => module))].map(module => [module, new Uint8Array([1])]))
    pkg.typeOriginTable = definitions.map(([moduleName, datatypeName]) => ({ moduleName, datatypeName, package: moduleName === 'registry' && datatypeName === 'SourceRevision2' ? callable : original })); f.rehashPackage()
    return { originalPackageId: original, callablePackageId: callable, callableDigest: f.deployment.callableDigest }
  }
  const target: CanonicalNativeWorkbenchTarget = { chainIdentifier: '35834a8a', standard: pin(std, standardId, aid(41), [['soul', 'Soul'], ['soul', 'ModuleKey'], ['soul', 'Changed']]),
    native: pin(native, nativeId, aid(44), [['birth', 'Created'], ['birth', 'CreationManifestCommitted'], ['registry', 'ContentMintKey'], ['birth', 'State'], ['birth', 'NativeModule'], ['birth', 'ContentKey'], ['birth', 'AuthorizationKey'], ['birth', 'PaidKey'], ['birth', 'ConfigurationKey'], ['birth', 'ContentOperator'], ['registry', 'SoulProducer'], ['registry', 'Registry'], ['registry', 'PersonalKiosk'], ['registry', 'SourceRevision2']]),
    registryId: vm.registryId, configId: aid(50) }
  const root = CanonicalSoulBcs.parse(fromHex(vm.rows.NEW.rootAfterReopenHex)), descriptor = root.modules[0]
  root.origin.minted_by = author
  if (initial) root.revision = '1'
  const state = { id: descriptor.object, root: root.id, protocol: target.configId, registry: vm.registryId, schema: 1, creator: author,
    description: 'Native workbench read', image: '', creator_royalty_bps: 250, created_at: '100', provenance: { kind: 0, origin: null, joined: null },
    mint_nonce: fromHex(vm.mintNonce), content: initial ? deriveNativeCreationContentId({ nativeOriginalPackageId: nativeId, registryId: vm.registryId } as any, author, vm.mintNonce) : aid(60), issuer: { original: nativeId, callable: aid(44), marker: { name: `${target.native.callablePackageId.slice(2)}::registry::SourceRevision2` }, version: '2' } }
  const stateBytes = CanonicalNativeStateBcs.serialize(state).toBytes(); descriptor.body_hash = sha3_256(stateBytes)
  const wrapperType = `0x2::dynamic_object_field::Wrapper<${standardId}::soul::ModuleKey<${nativeId}::birth::NativeModule>>`
  const key = bcs.byteVector().serialize(new TextEncoder().encode('native')).toBytes(), fieldId = deriveDynamicFieldID(root.id, wrapperType, key)
  const fieldBytes = bcs.struct('Field', { id: bcs.Address, name: bcs.struct('Wrapper', { name: bcs.struct('Key', { name: bcs.byteVector() }) }), value: bcs.Address })
    .serialize({ id: fieldId, name: { name: { name: new TextEncoder().encode('native') } }, value: state.id }).toBytes()
  const rows = new Map<string, any>([[std.pkg.objectId, std.pkg], [native.pkg.objectId, native.pkg]])
  function object(objectId: string, type: string, contents: Uint8Array, owner: string | { Shared: { initialSharedVersion: string } } | { AddressOwner: string }) {
    const raw = bcs.Object.serialize({ data: { Move: { type: { Other: TypeTagSerializer.parseFromStr(type).struct! }, hasPublicTransfer: true,
      version: '10', contents } }, owner: typeof owner === 'string' ? { ObjectOwner: owner } : owner, previousTransaction: adigest(5), storageRebate: '0' }).toBytes()
    const row = { objectId, version: 10n, digest: activityHash('Object', raw), bcs: { value: raw } }; rows.set(objectId, row); return row
  }
  object(root.id, `${standardId}::soul::Soul`, CanonicalSoulBcs.serialize(root).toBytes(), aid(99))
  object(fieldId, `0x2::dynamic_field::Field<${wrapperType},0x2::object::ID>`, fieldBytes, root.id)
  object(state.id, `${nativeId}::birth::State`, stateBytes, fieldId)
  let library: any = null, libraryFieldId = ''
  const records: Array<{ value: any; objectId: string }> = []
  if (withContent) {
    const content = await activityEvidenceFixture(), contentId = aid(80)
    target.content = pin(content, contentId, aid(81), [['founding_library', 'Library'], ['founding_library', 'Name'], ['founding_library', 'Version'], ['founding_library', 'BlobKey'], ['document', 'Record'], ['authorization', 'Authorization'], ['paid_access', 'Ledger'], ['state_configuration', 'Configuration']])
    rows.set(content.pkg.objectId, content.pkg)
    const wrapped = `0x2::dynamic_object_field::Wrapper<${nativeId}::birth::ContentKey>`
    libraryFieldId = deriveDynamicFieldID(state.id, wrapped, moveEmptyStructBytes())
    const field = bcs.struct('ContentField', { id: bcs.Address, name: bcs.struct('Wrapper', { name: MoveEmptyStructBcs }), value: bcs.Address })
    object(libraryFieldId, `0x2::dynamic_field::Field<${wrapped},0x2::object::ID>`, field.serialize({ id: libraryFieldId, name: { name: { dummy_field: false } }, value: state.content }).toBytes(), state.id)
    library = { id: state.content, root: root.id, controller: { operator: { name: `${nativeId}::birth::ContentOperator` }, parent: state.id, root: root.id },
      revision: String(count), records: { id: aid(5000), size: String(count) }, counts: { id: aid(5001), size: initial ? String(count) : '2' },
      indices: { id: aid(5002), size: String(count) }, active: { id: aid(5003), size: '0' }, entries: [] as any[] }
    for (let index = 0; index < count; index++) {
      const record = { kind: initial && index >= 2 ? 100 + index : index === 0 ? 0 : 1, name: initial && index >= 2 ? `record_${index}` : index === 0 ? 'soul' : 'default', version: initial ? '0' : String(Math.max(0, index - 1)),
        reference: { object: aid(6000 + index), blob_id: '123', sha256: new Uint8Array(32).fill(5), bytes: '100', certified_epoch: 9, end_epoch: 15 },
        read_mask: '3', op_mask: '6', scope: '1', download_policy: 0, nonce: new Uint8Array(16).fill(1), envelope: new Uint8Array([1, 2]),
        deleted: false, purged: false, created_at_ms: '100', seal_namespace: null }
      const bytes = CanonicalNativeRecordBcs.serialize(record).toBytes(), fieldId = deriveDynamicFieldID(library.records.id, 'u64', bcs.u64().serialize(index).toBytes())
      const field = bcs.struct('RecordField', { id: bcs.Address, name: bcs.u64(), value: CanonicalNativeRecordBcs })
      object(fieldId, `0x2::dynamic_field::Field<u64,${contentId}::document::Record>`, field.serialize({ id: fieldId, name: index, value: record }).toBytes(), library.records.id)
      library.entries.push({ index: String(index), hash: sha256(bytes) }); records.push({ value: record, objectId: fieldId })
      if (initial) {
        const Name = bcs.struct('Name', { kind: bcs.u32(), name: bcs.string() }), Version = bcs.struct('Version', { kind: bcs.u32(), name: bcs.string(), version: bcs.u64() })
        const name = { kind: record.kind, name: record.name }, version = { ...name, version: '0' }
        const countId = deriveDynamicFieldID(library.counts.id, `${contentId}::founding_library::Name`, Name.serialize(name).toBytes())
        const indexId = deriveDynamicFieldID(library.indices.id, `${contentId}::founding_library::Version`, Version.serialize(version).toBytes())
        object(countId, `0x2::dynamic_field::Field<${contentId}::founding_library::Name,u64>`,
          bcs.struct('Count', { id: bcs.Address, name: Name, value: bcs.u64() }).serialize({ id: countId, name, value: '1' }).toBytes(), library.counts.id)
        object(indexId, `0x2::dynamic_field::Field<${contentId}::founding_library::Version,u64>`,
          bcs.struct('Index', { id: bcs.Address, name: Version, value: bcs.u64() }).serialize({ id: indexId, name: version, value: String(index) }).toBytes(), library.indices.id)
        const wrapper = `0x2::dynamic_object_field::Wrapper<${contentId}::founding_library::BlobKey>`
        const blobFieldId = deriveDynamicFieldID(library.id, wrapper, bcs.u64().serialize(index).toBytes())
        object(blobFieldId, `0x2::dynamic_field::Field<${wrapper},0x2::object::ID>`, bcs.struct('BlobField', { id: bcs.Address,
          name: bcs.struct('Wrapper', { name: bcs.struct('BlobKey', { index: bcs.u64() }) }), value: bcs.Address })
          .serialize({ id: blobFieldId, name: { name: { index: String(index) } }, value: record.reference.object }).toBytes(), library.id)
      }
    }
    object(library.id, `${contentId}::founding_library::Library`, CanonicalNativeLibraryBcs.serialize(library).toBytes(), libraryFieldId)
  }
  let account: any = null, kiosk: any = null
  if (withCustody) {
    const custody = await activityEvidenceFixture()
    target.custody = pin(custody, aid(82), aid(83), [['account', 'Account']]); rows.set(custody.pkg.objectId, custody.pkg)
    const kioskId = aid(1000), accountId = aid(1002), itemId = deriveKioskItemFieldId(kioskId, root.id)
    object(root.id, `${standardId}::soul::Soul`, CanonicalSoulBcs.serialize(root).toBytes(), itemId)
    object(itemId, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs.serialize({ id: itemId, name: { name: { id: root.id } }, value: root.id }).toBytes(), kioskId)
    kiosk = { id: kioskId, profits: '0', owner: author, item_count: 1, allow_extensions: false }
    object(kioskId, '0x2::kiosk::Kiosk', SoulPublicKioskBcs.serialize(kiosk).toBytes(), { Shared: { initialSharedVersion: '1' } })
    account = { id: accountId, kiosk: kioskId, owner: author, authority: { cap: { id: aid(1001), for: kioskId }, kiosk: kioskId,
      owner: author, closed_digest: initial ? fromBase58(adigest(5)) : new Uint8Array(32).fill(1) } }
    object(accountId, `${aid(82)}::account::Account`, CanonicalOwnedAccountBcs.serialize(account).toBytes(), { AddressOwner: author })
    if (initial) {
      const lockId = deriveDynamicFieldID(kioskId, '0x2::kiosk::Lock', bcs.Address.serialize(root.id).toBytes())
      const Lock = bcs.struct('Lock', { id: bcs.Address, name: bcs.struct('Key', { id: bcs.Address }), value: bcs.bool() })
      object(lockId, '0x2::dynamic_field::Field<0x2::kiosk::Lock,bool>', Lock.serialize({ id: lockId, name: { id: root.id }, value: true }).toBytes(), kioskId)
    }

  }
  if (initial && target.content && target.custody) {
    for (const [from, dependencies] of [[target.native, [target.standard, target.content, target.custody]],
      [target.content, [target.standard]], [target.custody, [target.standard]]] as const) {
      const row = rows.get(from.callablePackageId), raw = bcs.Object.parse(row.bcs.value), pkg = raw.data.Package!
      pkg.linkageTable = new Map(dependencies.map(to => [to.originalPackageId, { upgradedId: to.callablePackageId,
        upgradedVersion: String(rows.get(to.callablePackageId).version) }]))
      row.bcs.value = bcs.Object.serialize(raw).toBytes(); row.digest = activityHash('Object', row.bcs.value)
      from.callableDigest = row.digest
    }
  }
  const client = { core: { getChainIdentifier: vi.fn(async () => ({ chainIdentifier: MAINNET_GENESIS_DIGEST })),
    listOwnedObjects: vi.fn(async () => ({ objects: account ? [{ objectId: account.id }] : [], hasNextPage: false, cursor: null as string | null })) }, ledgerService: {
    getObject: vi.fn(async ({ objectId }: any) => ({ response: { object: rows.get(objectId) } })) } }
  const input = { client: client as any, target, soulId: root.id, signal: new AbortController().signal, viewerAddress: withCustody ? author : null }
  return { input, rows, root, state, stateBytes, object, fieldId, standardId, nativeId, client, library, libraryFieldId, records, account, kiosk, read: () => readCanonicalNativeWorkbench(input) }
}
