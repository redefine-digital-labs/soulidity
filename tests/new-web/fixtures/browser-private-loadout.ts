import { vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase58, toBase64 } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { WalrusClient } from '../../../web/node_modules/@mysten/walrus/dist/index.mjs'
import { ProfileWalrusBlobBcs, PrivateNamedLoadoutHeadFieldV1Bcs, SoulStatePointerFieldV1Bcs,
  derivePrivateNamedLoadoutHeadFieldId } from '@soulidity/sdk'
import { NativeSoulStateBcs } from '../../../web/lib/animacraft/native-receive'
import { NativeArtworkOutputBcs } from '../../../web/lib/animacraft/native-artwork'
import { browserCompleteFixture, artId as id } from './browser-native-artwork'

/** Full raw native Release/Seal fixtures, plus the actual new head/Blob BCS.
 * Walrus cache boundary is the real SDK instance with local system-state I/O. */
export function browserPrivateLoadoutFixture(empty = false, publicOriginal = true) {
  const f = browserCompleteFixture(), digest = toBase58(new Uint8Array(32).fill(3))
  const state = NativeSoulStateBcs.parse(f.objects.get(id(14)).contents.value)
  state.active_grants = { id: id(601), size: '0' }; state.active_grant_ids = { id: id(602), size: '0' }
  state.config_ext = { id: id(603), size: '0' }; state.active_grant_count = '0'
  const putState = () => { f.objects.get(id(14)).contents.value = NativeSoulStateBcs.serialize(state).toBytes() }
  putState()
  const scope = { soulId: id(12), stateId: id(14), owner: state.current_owner, ownershipEpoch: state.ownership_epoch }
  const pkg = f.target.soulidityOriginalPackageId, keyType = `${pkg}::soul::SoulStatePointerKeyV1`
  const pointerId = deriveDynamicFieldID(scope.soulId, keyType, new Uint8Array([1]))
  f.objects.set(pointerId, { objectId: pointerId, version: 3n, digest, owner: { kind: 2, address: scope.soulId },
    objectType: `0x${'2'.padStart(64,'0')}::dynamic_field::Field<${keyType},0x${'2'.padStart(64,'0')}::object::ID>`,
    contents: { value: SoulStatePointerFieldV1Bcs.serialize({ id: pointerId, name: { version: 1 }, value: scope.stateId }).toBytes() } })
  if (publicOriginal) f.edit(id(15), NativeArtworkOutputBcs, out => { out.protected = false; out.seal_id = null; out.scope_key = ''; out.asset_key = '' })
  // No live equipment: policy uses immutable original output, not DF10.
  f.objects.delete(deriveDynamicFieldID(scope.stateId, 'u8', new Uint8Array([10])))
  f.objects.delete(id(80))
  const headFieldId = derivePrivateNamedLoadoutHeadFieldId(pkg, scope.stateId)
  const storage = { blobType: `${id(610)}::blob::Blob`, aggregatorUrl: 'https://walrus.example.com' }
  let ciphertext = new Uint8Array([5,6,7])
  const blobId = toBase64(new Uint8Array(32).fill(7)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
  const ref = { blob_object_id: id(611), blob_id: blobId, sha256: [...sha256(ciphertext)], byte_length: String(ciphertext.length) }
  const head = { version: 1, soul_id: scope.soulId, state_id: scope.stateId, owner: scope.owner, ownership_epoch: scope.ownershipEpoch,
    revision: '1', ciphertext: ref, receipts: [{ request_id: Array(32).fill(1), revision: '1', ciphertext: ref,
      capture: null as { equipment_id: string; revision: string; commitment: number[] } | null }] }
  const putHead = () => f.objects.set(headFieldId, { objectId: headFieldId, version: 3n, digest, owner: { kind: 2, address: scope.stateId },
    objectType: `0x${'2'.padStart(64,'0')}::dynamic_field::Field<${pkg}::soul::NamedLoadoutHeadKeyV1,${pkg}::named_loadout_v1::HeadV1>`,
    contents: { value: PrivateNamedLoadoutHeadFieldV1Bcs.serialize({ id: headFieldId, name: { version: 1 }, value: head }).toBytes() } })
  const blob = { id: id(611), registered_epoch: 1, blob_id: bcs.u256().parse(new Uint8Array(32).fill(7)), size: ref.byte_length,
    encoding_type: 1, certified_epoch: 2 as number | null, storage: { id: id(612), start_epoch: 1, end_epoch: 10, storage_size: '999999' }, deletable: true }
  const putBlob = () => f.objects.set(blob.id, { objectId: blob.id, version: 3n, digest, owner: { kind: 1, address: scope.owner },
    objectType: storage.blobType, contents: { value: ProfileWalrusBlobBcs.serialize(blob).toBytes() } })
  if (!empty) putHead(); putBlob(); f.normalize()
  const fetcher = vi.fn(async () => new Response(new Uint8Array(ciphertext)))
  let walrusClient: unknown
  const walrus = new WalrusClient({ suiClient: f.client, network: 'mainnet' })
  const reset = vi.spyOn(walrus, 'reset')
  const blobType = vi.spyOn(walrus, 'getBlobType').mockReturnValue(storage.blobType)
  const system = vi.spyOn(walrus, 'systemState').mockResolvedValue({ committee: { epoch: 3 } } as any)
  const walrusFactory = vi.fn(client => { walrusClient = client; return walrus })
  const setCiphertext = (bytes: Uint8Array) => { ciphertext = new Uint8Array(bytes); ref.sha256 = [...sha256(bytes)]; ref.byte_length = String(bytes.length)
    blob.size = ref.byte_length; putHead(); putBlob() }
  return { ...f, scope, state, head, headFieldId, pointerId, storage, ref, blob, putState, putHead, putBlob, setCiphertext,
    config: { ...f.config, storage }, fetcher, reset, blobType, system, walrusFactory, walrusClient: () => walrusClient,
    dependencies: { client: f.factory, walrus: walrusFactory } }
}
