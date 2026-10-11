import { vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { sha256 } from '@noble/hashes/sha2.js'
import { deriveDynamicFieldID, toHex } from '@mysten/sui/utils'
import { SoulDetailStateBcs as D, SoulContentKeyPublicBcs, SoulContentSlotPublicBcs } from '@soulidity/sdk'
import { contentAppendPreparationFixture } from './content-append-preparation'
import { browserContentAccessFixture } from './browser-content-access-raw'
import { prepareContentAppend, contentAppendPreparedEnvelope } from '../../../web/lib/soulidity/content-append-preparation'
import { contentEnvelopeKey } from '../../../web/lib/soulidity/content-envelope'
import { readBrowserContentWriteState } from '../../../web/lib/soulidity/browser-content-write-state'
import { runContentAppend, type ContentAppendIntent } from '../../../web/lib/soulidity/content-append-operation'
import type { SoulUploadResult } from '../../../web/lib/upload/client-upload'

// Real raw proof readers and actual AES/Seal preparation + Ed25519 personal
// signature. Transport rows, upload/payment and ACK are local fixtures: this is
// not a wallet transaction, Walrus broadcast or signature end-to-end acceptance.
export async function contentAppendOperationFixture(options: {
  grantee?: boolean; newKind?: boolean; newName?: boolean; memory?: boolean; intent?: Partial<ContentAppendIntent>
} = {}) {
  const crypto = await contentAppendPreparationFixture(), raw = browserContentAccessFixture(), author = crypto.signer.toSuiAddress()
  const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`, pkg = raw.deployment.originalPackageId
  if (options.grantee) {
    const old = raw.tables.get(raw.state.active_grants.id)![0].fieldId
    raw.rows.delete(old); raw.tables.set(raw.state.active_grants.id, [])
    raw.grantSlot.grantee = author; raw.grant.grantee = author
    raw.field(raw.state.active_grants.id, 'address', bcs.Address, author, `${pkg}::soul::ActiveGrantSlot`, D.GrantSlot, raw.grantSlot)
    raw.field(raw.state.active_grant_ids.id, '0x2::object::ID', bcs.Address, raw.grant.id, 'address', bcs.Address, author)
    raw.putGrant({ kind: 1, address: author })
  } else {
    raw.state.current_owner = author; raw.putState(); raw.grant.issued_by = author; raw.putGrant()
  }
  const kind = options.memory ? 1 : options.newKind ? 16 : 3, name = options.memory ? 'default' : options.newKind || options.newName ? 'new_slot' : 'main'
  const memorySlots = [{ ...raw.slots[0], kind: 1, blob_object_id: id(9100), read_mode_mask: '3',
    op_mask: '7', grant_scope_mask: '2', download_policy: 0 }]
  const putMemorySlots = () => raw.field(raw.content.items.id, `${pkg}::content::ContentKey`, SoulContentKeyPublicBcs,
    { kind: 1, name: 'default' }, `vector<${pkg}::content::ContentSlot>`, bcs.vector(SoulContentSlotPublicBcs), memorySlots)
  if (options.memory) {
    if (options.newKind || options.newName) throw new Error('Memory fixture uses the canonical existing default slot')
    putMemorySlots()
    raw.content.items.size = String(BigInt(raw.content.items.size) + 1n)
    raw.content.count_by_kind.size = String(BigInt(raw.content.count_by_kind.size) + 1n)
    raw.field(raw.content.count_by_kind.id, 'u32', bcs.u32(), 1, 'u64', bcs.u64(), '1')
    raw.field(raw.registry.kinds.id, 'u32', bcs.u32(), 1, `${pkg}::kind_registry::KindDescriptor`, D.Descriptor,
      { ...raw.descriptor, kind: 1, name: 'memory', op_mask: '7', read_mode_mask: '3',
        has_active_binding: false, requires_download_policy: false, default_grant_scope_mask: '2' })
    raw.field(raw.registry.name_to_kind.id, '0x1::string::String', bcs.string(), 'memory', 'u32', bcs.u32(), 1)
    raw.putContent()
  }
  if (options.newKind) {
    raw.registry.next_kind = 17; raw.putRegistry()
    raw.field(raw.registry.kinds.id, 'u32', bcs.u32(), 16, `${pkg}::kind_registry::KindDescriptor`, D.Descriptor,
      { ...raw.descriptor, kind: 16, name: 'custom_new', op_mask: '7', has_active_binding: false })
    raw.field(raw.registry.name_to_kind.id, '0x1::string::String', bcs.string(), 'custom_new', 'u32', bcs.u32(), 16)
  }
  const uploadConfig = { network: 'mainnet' as const, relayUrl: 'https://relay.example.com', wasmUrl: '/walrus/walrus_wasm@0.0.2.wasm', storageEpochs: 26 }
  let intent: ContentAppendIntent = { schema: 'soulidity.content-append-intent.v1', rebase: null, soulId: raw.soul.id, stateId: raw.state.id,
    kindRegistryId: raw.registry.id, marketConfigId: id(7000), ownershipEpoch: raw.state.ownership_epoch,
    grantId: options.grantee ? raw.grant.id : null, readModeMask: 3, downloadPolicy: options.memory ? 'public' : 'owner_only',
    spriteConfigJson: null, setActive: false, autoGrantPlan: null,
    contentHash: toHex(sha256(crypto.params.plaintext)), plaintextByteLength: crypto.params.plaintext.length,
    fileName: crypto.params.fileName, mimeType: crypto.params.mimeType, uploadConfig, ...options.intent }
  const config = { target: raw.config.target, kindRegistryId: raw.registry.id }
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
    NEXT_PUBLIC_SEAL_THRESHOLD: String(crypto.params.sealConfig.threshold), NEXT_PUBLIC_SEAL_SESSION_TTL_MIN: String(crypto.params.sealConfig.ttlMin),
    NEXT_PUBLIC_SEAL_SERVER_CONFIGS: JSON.stringify(crypto.params.sealConfig.serverConfigs), NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS: 'true',
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: pkg, NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: config.target.soulidityCallablePackageId,
    NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID: raw.registry.id, NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID: intent.marketConfigId,
    NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL: uploadConfig.relayUrl, NEXT_PUBLIC_WALRUS_WASM_URL: uploadConfig.wasmUrl })) vi.stubEnv(key, value)
  const scope = { ...crypto.params.scope, originalPackageId: pkg, callablePackageId: config.target.soulidityCallablePackageId,
    contentObjectId: raw.content.id, kind, name, versionIndex: options.memory ? '1' : options.newKind || options.newName ? '0' : '2', intentJson: JSON.stringify(intent) }
  let record = await prepareContentAppend({ ...crypto.params, scope })
  const attributes: Record<string, string> = { max_programmable_tx_commands: '1024', max_pure_argument_size: '65540', max_tx_size_bytes: '131072' }
  vi.spyOn(raw.client.core, 'getProtocolConfig').mockImplementation(async () => ({ protocolConfig: { attributes } }) as any)
  let wallet: string | null = author
  const sign = vi.fn(async () => { throw new Error('No transaction signature in this fixture') })
  const beforeWrite = vi.fn(async () => {})
  const execution = { client: raw.client, getAddress: () => wallet, sign, beforeWrite }
  const readParams = { config, soulId: raw.soul.id, stateId: raw.state.id, contentId: raw.content.id, kind,
    viewerAddress: author, signal: crypto.controller.signal }
  const read = vi.fn(async () => readBrowserContentWriteState(readParams, { client: () => raw.client }))
  const proof = await read(); read.mockClear()
  const result: SoulUploadResult = { blobObjectId: id(9000), blobId: 'fixture-certified-blob', blobUrl: 'https://walrus.example.com/v1/blobs/fixture',
    contentHash: record.contentHash, storageTxDigest: 'fixture-register', certifyTxDigest: 'fixture-certify', quoteId: 'fixture-quote', recoveryKey: 'fixture-paid-recovery' }
  const setConfig = (key: string, bytes: Uint8Array) => {
    const previous = raw.tables.get(raw.state.config_ext.id)!.length
    raw.field(raw.state.config_ext.id, '0x1::string::String', bcs.string(), key, 'vector<u8>', bcs.vector(bcs.u8()), [...bytes])
    if (raw.tables.get(raw.state.config_ext.id)!.length !== previous) raw.state.config_ext.size = String(BigInt(raw.state.config_ext.size) + 1n)
    raw.putState()
  }
  function finalize() {
    const slot = { ...raw.slots[0], kind, blob_object_id: result.blobObjectId, read_mode_mask: String(intent.readModeMask),
      is_public: !!(intent.readModeMask & 8), download_policy: intent.downloadPolicy === 'public' ? 0 : intent.downloadPolicy === 'owner_only' ? 1 : 2,
      op_mask: options.memory || options.newKind ? '7' : '15', grant_scope_mask: options.memory ? '2' : raw.slots[0].grant_scope_mask }
    if (options.memory) { memorySlots.push(slot); putMemorySlots() }
    else if (options.newKind || options.newName) {
      raw.field(raw.content.items.id, `${pkg}::content::ContentKey`, SoulContentKeyPublicBcs, { kind, name },
        `vector<${pkg}::content::ContentSlot>`, bcs.vector(SoulContentSlotPublicBcs), [slot])
      raw.content.items.size = String(BigInt(raw.content.items.size) + 1n)
      raw.field(raw.content.count_by_kind.id, 'u32', bcs.u32(), kind, 'u64', bcs.u64(), options.newKind ? '1' : '2')
      if (options.newKind) raw.content.count_by_kind.size = String(BigInt(raw.content.count_by_kind.size) + 1n)
      raw.putContent()
    } else { raw.slots.push(slot); raw.putSlots() }
    const key = contentEnvelopeKey({ contentObjectId: scope.contentObjectId, kind, name, versionIndex: scope.versionIndex, blobObjectId: result.blobObjectId })
    setConfig(key, contentAppendPreparedEnvelope(record, result.blobObjectId))
    if (intent.spriteConfigJson !== null) setConfig('sprite_config_json', new TextEncoder().encode(intent.spriteConfigJson))
    if (intent.setActive) { raw.active.name = name; raw.active.version_index = scope.versionIndex; raw.active.download_policy = slot.download_policy; raw.putActive() }
    if (intent.autoGrantPlan) {
      raw.state.grant_capacity = intent.autoGrantPlan.capacityAfter
      for (const [n, target] of intent.autoGrantPlan.targets.entries()) {
        const existing = target.address === raw.grant.grantee, grantId = id(8000 + n)
        if (existing) {
          const oldReverse = deriveDynamicFieldID(raw.state.active_grant_ids.id, '0x2::object::ID', bcs.Address.serialize(raw.grant.id).toBytes())
          raw.rows.delete(oldReverse)
          raw.tables.set(raw.state.active_grant_ids.id, raw.tables.get(raw.state.active_grant_ids.id)!.filter(v => v.fieldId !== oldReverse))
        } else {
          raw.state.active_grants.size = String(BigInt(raw.state.active_grants.size) + 1n)
          raw.state.active_grant_ids.size = String(BigInt(raw.state.active_grant_ids.size) + 1n)
          raw.state.active_grant_count = String(BigInt(raw.state.active_grant_count) + 1n)
        }
        const grant = { ...raw.grant, id: grantId, grantee: target.address, scope_mask: String(target.scopeMask), expires_at_ms: null }
        const slot = { ...raw.grantSlot, grant_id: grantId, grantee: target.address, scope_mask: String(target.scopeMask), expires_at_ms: null }
        raw.field(raw.state.active_grants.id, 'address', bcs.Address, target.address, `${pkg}::soul::ActiveGrantSlot`, D.GrantSlot, slot)
        raw.field(raw.state.active_grant_ids.id, '0x2::object::ID', bcs.Address, grantId, 'address', bcs.Address, target.address)
        raw.rows.set(grantId, { ...raw.rows.get(raw.grant.id)!, objectId: grantId, owner: { kind: 1, address: target.address },
          contents: { value: D.Grant.serialize(grant).toBytes() } })
      }
      raw.putState()
    }
  }
  const acknowledge = vi.fn(async () => {}), confirmQuote = vi.fn(async () => true)
  const upload = vi.fn(async (_input: any) => { finalize(); return result })
  const run = (overrides: Record<string, unknown> = {}) => runContentAppend({ record, config, execution, signal: crypto.controller.signal, confirmQuote },
    { read: read as any, upload, acknowledge, ...overrides } as any)
  const bindPreparedRecord = (next: typeof record) => {
    for (const key of ['author', 'originalPackageId', 'callablePackageId', 'contentObjectId', 'kind', 'name', 'versionIndex'] as const)
      if (next.scope[key] !== scope[key]) throw new Error(`Prepared fixture scope mismatch: ${key}`)
    const nextIntent = JSON.parse(next.scope.intentJson) as ContentAppendIntent
    if (nextIntent.soulId !== raw.soul.id || nextIntent.stateId !== raw.state.id || nextIntent.kindRegistryId !== raw.registry.id)
      throw new Error('Prepared fixture root mismatch')
    record = next; intent = nextIntent; result.contentHash = next.contentHash
  }
  return { raw, crypto, get record() { return record }, get intent() { return intent }, scope, config, execution, proof, read, attributes, result, upload, bindPreparedRecord,
    acknowledge, confirmQuote, beforeWrite, sign, run, finalize, setConfig, setWallet: (v: string | null) => { wallet = v } }
}
