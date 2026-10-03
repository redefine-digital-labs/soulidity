import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { SoulStatePublicBcs, SoulContentKeyPublicBcs, SoulContentSlotPublicBcs, ProfileWalrusBlobBcs, readSoulPublicSnapshotBySoulId, readSoulPublicListing } from '@soulidity/sdk'
import { WalrusClient } from '../../../web/node_modules/@mysten/walrus/dist/index.mjs'
import { readBrowserContentAccess } from '../../../web/lib/soulidity/browser-content-access'
import { openBrowserSoulContent } from '../../../web/lib/soulidity/browser-content-open'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'
import { readBrowserContentWriteState } from '../../../web/lib/soulidity/browser-content-write-state'
import { prepareContentAppend, contentAppendPreparedEnvelope } from '../../../web/lib/soulidity/content-append-preparation'
import { runContentAppend } from '../../../web/lib/soulidity/content-append-operation'
import { contentEnvelopeKey } from '../../../web/lib/soulidity/content-envelope'
import { createContentBrowserCrypto } from './content-browser-crypto'
import { composeChainSoulDetail } from '../../../web/lib/soulidity/soul-detail-model'

/** Test-only wire codec, preserving package metadata, raw BCS and u64 values. */
export const appendWireReplacer = (_key: string, value: any) => typeof value === 'bigint' ? { $bigint: String(value) }
  : value instanceof Uint8Array ? { $bytes: [...value] } : value
export const appendWireReviver = (_key: string, value: any) => value && typeof value === 'object' && '$bigint' in value ? BigInt(value.$bigint)
  : value && typeof value === 'object' && '$bytes' in value ? new Uint8Array(value.$bytes) : value

/** Real readers/preparation/runner; only raw transport, local Seal key transport,
 * upload and ACK are controlled. The caller keeps the production IDB store. */
export async function createContentAppendBrowserRuntime(input?: any) {
  const data = input ?? JSON.parse(await (await fetch('./append-fixture.json')).text(), appendWireReviver)
  const crypto = await createContentBrowserCrypto(), rows = new Map<string, any>(data.rows), tables = new Map<string, any[]>(data.tables)
  const state = structuredClone(data.state), content = data.content, config = data.config, pkg = config.target.soulidityOriginalPackageId
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://controlled-grpc.example.com' })
  Object.defineProperty(client, 'grpc', { value: client })
  client.core.getChainIdentifier = async () => ({ chainIdentifier: MAINNET_GENESIS_DIGEST })
  client.core.getDynamicField = async () => ({ dynamicField: structuredClone(data.dynamicField) }) as any
  client.core.getProtocolConfig = async () => ({ protocolConfig: { attributes: data.attributes } }) as any
  client.core.executeTransaction = async () => { throw new Error('Controlled browser fixture cannot broadcast') }
  client.core.resolveTransactionPlugin = crypto.client.core.resolveTransactionPlugin.bind(crypto.client.core)
  client.core.getMoveFunction = crypto.client.core.getMoveFunction.bind(crypto.client.core)
  client.core.getObjects = crypto.client.core.getObjects.bind(crypto.client.core)
  client.ledgerService.getObject = (async (args: any) => ({ response: { object: structuredClone(rows.get(args.objectId)) } })) as any
  client.ledgerService.batchGetObjects = (async (args: any) => ({ response: { objects: args.requests.map((r: any) => ({ result:
    rows.has(r.objectId) ? { oneofKind: 'object', object: structuredClone(rows.get(r.objectId)) } : { oneofKind: 'error', error: { code: 5 } } })) } })) as any
  client.stateService.listDynamicFields = (async (args: any) => ({ response: { dynamicFields: structuredClone(tables.get(args.parent) ?? []) } })) as any
  const stats = { reads: 0, preparations: 0, uploads: 0, acknowledgements: 0, completed: 0, lastVersion: '', payloadBytes: 0, opened:0 }
  const originalBlobType = WalrusClient.prototype.getBlobType, originalSystem = WalrusClient.prototype.systemState
  WalrusClient.prototype.getBlobType = () => data.accessConfig.storage.blobType
  WalrusClient.prototype.systemState = async () => ({committee:{epoch:3}}) as any
  const read = async (params: any = {}) => {
    stats.reads++
    return readBrowserContentWriteState({ config, soulId: data.soul.id, stateId: state.id, contentId: content.id,
      viewerAddress: crypto.account.address, kind: 1, ...params }, { client: () => client })
  }
  const prepare = async (params: Parameters<typeof prepareContentAppend>[0]) => {
    const record = await prepareContentAppend({ ...params, wallet: { ...params.wallet, client: crypto.client, sealClient: crypto.client } })
    stats.preparations++; return record
  }
  const detail = async () => {
    const asset = await readSoulPublicSnapshotBySoulId({ client, deployment: data.deployment, soulId: data.soul.id })
    const proof = await read()
    const listing = await readSoulPublicListing({ client, deployment: data.listingDeployment, stateId: state.id,
      listingId: null, expectedState: { version: asset.stateVersion, digest: asset.stateDigest } })
    return composeChainSoulDetail({ originalPackageId: pkg, asset, state: proof.snapshot, listing,
      currentKioskCapId: null, viewerAddress: crypto.account.address })
  }
  function field(parent: string, keyType: string, codec: any, key: any, valueType: string, valueCodec: any, value: any) {
    const keyBytes = codec.serialize(key).toBytes(), fieldId = deriveDynamicFieldID(parent, keyType, keyBytes)
    rows.set(fieldId, { objectId: fieldId, objectType: normalizeStructTag(`0x2::dynamic_field::Field<${keyType},${valueType}>`),
      version: 1n, digest: toBase58(new Uint8Array(32).fill(1)), owner: { kind: 2, address: parent },
      contents: { value: bcs.struct('Field', { id: bcs.Address, name: codec, value: valueCodec }).serialize({ id: fieldId, name: key, value }).toBytes() } })
    const list = tables.get(parent) ?? []
    if (!list.some(v => v.fieldId === fieldId)) list.push({ fieldId, kind: 1, name: { name: keyType, value: keyBytes }, valueType })
    tables.set(parent, list)
  }
  let latestRecord: any = null, latestProof: any = null
  const run = async (params: Parameters<typeof runContentAppend>[0]) => {
    const record = params.record, scope = record.scope, intent = JSON.parse(scope.intentJson)
    if (scope.contentObjectId !== content.id || scope.kind !== 1 || scope.name !== 'default' || scope.author !== crypto.account.address)
      throw new Error('Controlled append identity mismatch')
    const result = { ...data.result, contentHash: record.contentHash }
    const outcome = await runContentAppend(params, { read: read as any,
      upload: async (upload: any) => {
        if (upload.payload.length !== record.ciphertext.length || !upload.payload.every((v: number, i: number) => v === record.ciphertext[i]))
          throw new Error('Controlled upload ciphertext mismatch')
        const proof = await read(), versions = proof.snapshot.contentVersions.filter(v => v.kind === 1 && v.name === 'default')
        if (String(versions.length) !== scope.versionIndex) throw new Error('Controlled append version mismatch')
        const slots = versions.map(v => structuredClone(v.slot))
        slots.push({ ...slots[0], blob_object_id: result.blobObjectId, read_mode_mask: String(intent.readModeMask),
          is_public: !!(intent.readModeMask & 8), download_policy: intent.downloadPolicy === 'public' ? 0 : intent.downloadPolicy === 'owner_only' ? 1 : 2 })
        field(content.items.id, `${pkg}::content::ContentKey`, SoulContentKeyPublicBcs, { kind: 1, name: 'default' },
          `vector<${pkg}::content::ContentSlot>`, bcs.vector(SoulContentSlotPublicBcs), slots)
        const prior = tables.get(state.config_ext.id)!.length
        field(state.config_ext.id, '0x1::string::String', bcs.string(), contentEnvelopeKey({ contentObjectId: content.id,
          kind: 1, name: 'default', versionIndex: scope.versionIndex, blobObjectId: result.blobObjectId }), 'vector<u8>', bcs.vector(bcs.u8()),
        [...contentAppendPreparedEnvelope(record, result.blobObjectId)])
        state.config_ext.size = String(BigInt(state.config_ext.size) + BigInt(tables.get(state.config_ext.id)!.length - prior))
        rows.get(state.id).contents.value = SoulStatePublicBcs.serialize(state).toBytes()
        const key = bcs.struct('ContentBlobKey',{kind:bcs.u32(),name:bcs.string(),version_index:bcs.u64()})
        const wrapped = bcs.struct('Wrapper',{name:key}), value = {name:{kind:1,name:'default',version_index:scope.versionIndex}}
        const type = `0x2::dynamic_object_field::Wrapper<${pkg}::content::ContentBlobKey>`
        const wrapperId = deriveDynamicFieldID(content.id,type,wrapped.serialize(value).toBytes())
        field(content.id,type,wrapped,value,'0x2::object::ID',bcs.Address,result.blobObjectId)
        rows.set(result.blobObjectId,{objectId:result.blobObjectId,objectType:normalizeStructTag(data.accessConfig.storage.blobType),
          version:1n,digest:toBase58(new Uint8Array(32).fill(1)),owner:{kind:2,address:wrapperId},contents:{value:ProfileWalrusBlobBcs.serialize({
            ...data.blob,id:result.blobObjectId,size:String(record.ciphertext.length)}).toBytes()}})
        stats.uploads++; stats.payloadBytes = upload.payload.length; latestRecord = record
        return result
      }, acknowledge: async () => { stats.acknowledgements++ } })
    stats.completed++; stats.lastVersion = outcome.version.versionIndex; latestProof = await read()
    return outcome
  }
  const open = (params: Parameters<typeof openBrowserSoulContent>[0]) => openBrowserSoulContent({...params,
    client,sealClient:crypto.client}, {
    read: async request => {
      const proof = await readBrowserContentAccess(request,{client:()=>client})
      crypto.authorizeDocument(proof.access.sealSidecar.documentId)
      return proof
    }, fetcher:async url=> {
      if(!latestRecord)throw Error('No controlled uploaded content')
      const proof = await readBrowserContentAccess({...params.request,config:data.accessConfig},{client:()=>client})
      if(String(url)!==proof.access.artifact.walrusBlobUrl)throw Error('Wrong controlled Blob URL')
      return new Response(new Uint8Array(latestRecord.ciphertext))
    }
  }).then(result=>{stats.opened++;return result})
  return { client: client as SuiGrpcClient & { grpc: SuiGrpcClient }, account: crypto.account, wallet: crypto.wallet,
    config, accessConfig:data.accessConfig, sealConfig: data.sealConfig, env: data.env, signPersonalMessage: crypto.signPersonalMessage,
    read, prepare, run, detail, open, stats, soulIds: { soulId: data.soul.id, stateId: state.id, contentId: content.id },
    data, dispose: ()=>{WalrusClient.prototype.getBlobType=originalBlobType;WalrusClient.prototype.systemState=originalSystem;crypto.dispose()}, latest: () => ({ record: latestRecord, proof: latestProof }) }
}
