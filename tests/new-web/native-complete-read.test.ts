import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { nativeCompleteReadFixture, completeId as id } from './fixtures/native-complete-read'
import { completeReadAggregatorUrls, readNativeCompleteReadTarget } from '../../web/lib/animacraft/native-complete-read'
import { NativeSoulBindingBcs, NativeSoulStateBcs, readNativeReceiveTarget } from '../../web/lib/animacraft/native-receive'
import { NativeArtworkOutputBcs } from '../../web/lib/animacraft/native-artwork'
import { CompleteReadCatalogBcs, CompleteReadReceiptBcs, CompleteReadReleaseConfigBcs, CompleteReadEmptyKeyBcs,
  CompleteReadNativeSlotBcs, completeReadHash } from '../../web/lib/animacraft/native-complete-read-bcs'
import { EquipmentMakerBcs, EquipmentProtocolBcs } from '../../web/lib/animacraft/native-equipment-source-bcs'
import { equipmentProtocolCommitment } from '../../web/lib/animacraft/native-equipment-source'
import { EquipmentProtectedAssetBcs, EquipmentProtectedKeyBcs, EquipmentSealPolicyBcs, EquipmentSealRegistryBcs } from '../../web/lib/animacraft/native-equipment-seal'

afterEach(() => vi.unstubAllEnvs())
it('returns an exact original Release target, canonical AAD and verified weighted policy without media or signer', async () => {
  const f = nativeCompleteReadFixture(), view = await f.read()
  expect(view).toMatchObject({ schema: 'native-complete-read-v1', soulId: id(12), stateId: id(14), owner: id(11), ownershipEpoch: '0',
    bindingId: id(13), outputId: id(15), receiptId: id(16), rootId: id(10), protocolConfigId: id(1), catalogId: id(32),
    releaseConfigId: id(265), sealRegistryId: id(87), sealPolicyId: id(260), release: f.target.release,
    ciphertext: { blobId: f.blobId, sha256: '41'.repeat(32), aadBase64: Buffer.from(f.aad).toString('base64') },
    policy: { keyServers: [{ objectId: id(270), weight: 2 }, { objectId: id(271), weight: 3 }], threshold: 4 } })
  expect(view.ciphertext.sealId).toEqual(completeReadHash(Buffer.from(view.ciphertext.aadBase64, 'base64')))
  expect(f.calls.length).toBeLessThan(80)
  expect(JSON.stringify(view)).not.toMatch(/private|apiKey|signature|"plaintext"/i)
})
it('needs no Runtime write/selection pin, wallet pass, equipment or source manifests', async () => {
  const f = nativeCompleteReadFixture(); const { runtime: _, ...target } = f.target
  for (const objectId of [id(80), id(81), id(82), id(83), id(84), id(85)]) f.objects.delete(objectId)
  expect((await readNativeCompleteReadTarget(f.client, target, { soulId: id(12), stateId: id(14) })).outputId).toBe(id(15))
  expect(f.objects.get(id(241)).package.linkage.some((row: any) => row.originalId === id(230))).toBe(false)
  expect(f.calls.some(row => row.objectId === id(231))).toBe(false)
})
it('derives the new listed holder/epoch while issuance holder stays frozen; paused/archived Root and protocol changes are readable', async () => {
  const f = nativeCompleteReadFixture()
  f.set(id(14), NativeSoulStateBcs, row => { row.current_owner = id(999); row.ownership_epoch = '12'; row.is_listed = true })
  f.set(id(10), EquipmentMakerBcs, row => { row.lifecycle = 3 })
  f.set(id(1), EquipmentProtocolBcs, row => { row.enabled = false; row.revision = '30'; row.commitment = equipmentProtocolCommitment(row) })
  expect(await f.read()).toMatchObject({ owner: id(999), ownershipEpoch: '12' })
})
it.each(['cipherSuite','keyDerivation','ciphertextFormat'] as const)('rejects canonically bound but unsupported %s', async key => {
  const f = nativeCompleteReadFixture({ [key]: 'unsupported' })
  await expect(f.read()).rejects.toMatchObject({ code: 'NATIVE_SEAL_PROFILE_UNSUPPORTED', status: 503 })
})
it('rejects missing explicit Release pin with 503 before reads', async () => {
  const f = nativeCompleteReadFixture(); const { release: _, ...target } = f.target
  await expect(readNativeCompleteReadTarget(f.client, target, { soulId: id(12), stateId: id(14) })).rejects.toMatchObject({ status: 503 })
  expect(f.calls).toHaveLength(0)
})
it('accepts the largest representable SDK policy and rejects canonically committed excessive shares', async () => {
  expect((await nativeCompleteReadFixture({}, { weights: [127,127], threshold: 254 }).read()).policy.threshold).toBe(254)
  for (const weights of [[127,128], [65535,1]] as [number, number][]) {
    await expect(nativeCompleteReadFixture({}, { weights, threshold: 1 }).read())
      .rejects.toThrow('Seal policy bounds invalid')
  }
})
it.each([
  ['binding-soul', id(13), NativeSoulBindingBcs, (r: any) => { r.soul_id = id(999) }],
  ['binding-state', id(13), NativeSoulBindingBcs, (r: any) => { r.soul_state_id = id(999) }],
  ['binding-protocol', id(13), NativeSoulBindingBcs, (r: any) => { r.protocol_config_id = id(999) }],
  ['binding-authorization', id(13), NativeSoulBindingBcs, (r: any) => { r.authorization_commitment[0] ^= 1 }],
  ['state-soul', id(14), NativeSoulStateBcs, (r: any) => { r.soul_id = id(999) }],
  ['receipt-id', id(16), CompleteReadReceiptBcs, (r: any) => { r.output_id = id(999) }],
  ['receipt-schema', id(16), CompleteReadReceiptBcs, (r: any) => { r.renderer_schema_commitment[0] ^= 1 }],
  ['receipt-payment', id(16), CompleteReadReceiptBcs, (r: any) => { r.total_paid_atomic = '1' }],
  ['receipt-holder', id(16), CompleteReadReceiptBcs, (r: any) => { r.holder = id(999) }],
  ['output-render', id(15), NativeArtworkOutputBcs, (r: any) => { r.render_blob_commitment[0] ^= 1 }],
  ['output-sha', id(15), NativeArtworkOutputBcs, (r: any) => { r.render_sha256[0] ^= 1 }],
  ['output-protection', id(15), NativeArtworkOutputBcs, (r: any) => { r.protection_binding_commitment[0] ^= 1 }],
  ['output-seal', id(15), NativeArtworkOutputBcs, (r: any) => { r.seal_id[0] ^= 1 }],
  ['root-hash', id(10), EquipmentMakerBcs, (r: any) => { r.content.content_commitment[0] ^= 1 }],
  ['root-draft', id(10), EquipmentMakerBcs, (r: any) => { r.lifecycle = 0 }],
  ['root-renderer', id(10), EquipmentMakerBcs, (r: any) => { r.content.renderer_commitment[0] ^= 1 }],
  ['protocol-hash', id(1), EquipmentProtocolBcs, (r: any) => { r.commitment[0] ^= 1 }],
  ['catalog-role', id(32), CompleteReadCatalogBcs, (r: any) => { r.binding.bindings[6].callable_package_id = id(999) }],
  ['catalog-cap', id(32), CompleteReadCatalogBcs, (r: any) => { r.authority_ids[5] = id(999) }],
  ['catalog-installation', id(32), CompleteReadCatalogBcs, (r: any) => { r.role_config_commitments[5][0] ^= 1 }],
  ['release-config', id(265), CompleteReadReleaseConfigBcs, (r: any) => { r.installation_commitment[0] ^= 1 }],
  ['seal-registry', id(87), EquipmentSealRegistryBcs, (r: any) => { r.commitment[0] ^= 1 }],
  ['seal-registry-root', id(87), EquipmentSealRegistryBcs, (r: any) => { r.root_id = id(999) }],
  ['seal-policy', id(260), EquipmentSealPolicyBcs, (r: any) => { r.policy_config_id = id(999); r.commitment[0] ^= 1 }],
  ['key-server-weight', id(260), EquipmentSealPolicyBcs, (r: any) => { r.key_servers[0].weight = 3 }],
  ['key-server-order', id(260), EquipmentSealPolicyBcs, (r: any) => { r.key_servers.reverse() }],
  ['threshold', id(260), EquipmentSealPolicyBcs, (r: any) => { r.threshold = 1 }],
])('rejects substituted %s', async (_name, objectId, schema, change) => {
  const f = nativeCompleteReadFixture(); f.set(objectId as string, schema, change as any)
  await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it.each([id(5), id(4), id(241)])('rejects pinned package digest mismatch %s', async pkgId => {
  const f = nativeCompleteReadFixture(); f.objects.get(pkgId).digest = 'bad'
  await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it.each(['missing', 'wrong-version', 'duplicate'])('rejects %s Release native linkage', async mode => {
  const f = nativeCompleteReadFixture(), links = f.objects.get(id(241)).package.linkage
  const i = links.findIndex((r: any) => r.originalId === id(6))
  if (mode === 'missing') links.splice(i,1)
  else if (mode === 'duplicate') links.push({ ...links[i] })
  else links[i].upgradedVersion = 99n
  await expect(f.read()).rejects.toMatchObject({ code: 'NATIVE_COMPLETE_READ_INVALID' })
})
it.each(['id','type','owner','bcs'])('rejects actual marker %s substitution', async mode => {
  const f = nativeCompleteReadFixture(), obj = f.objects.get(f.markerId)
  if (mode === 'id') obj.objectId = id(999)
  if (mode === 'type') obj.objectType = '0x2::dynamic_field::Field<bool,0x2::object::ID>'
  if (mode === 'owner') obj.owner.address = id(999)
  if (mode === 'bcs') f.set(f.markerId, bcs.struct('Field',{id:bcs.Address,name:CompleteReadEmptyKeyBcs,value:bcs.Address}), row => { row.name.dummy_field = true })
  await expect(f.read()).rejects.toBeInstanceOf(Error)
})
it('rejects actual native type slot substitution independent of facade discovery', async () => {
  const f = nativeCompleteReadFixture()
  f.set(f.slotId, bcs.struct('Field',{id:bcs.Address,name:CompleteReadEmptyKeyBcs,value:CompleteReadNativeSlotBcs}), row => { row.value.owner_defining.name = `${id(999).slice(2)}::animacraft_v8_binding::SoulOwnerWitnessV8` })
  await expect(f.read()).rejects.toMatchObject({ code: 'NATIVE_COMPLETE_READ_INVALID' })
})
it.each(['scope_kind','scope_commitment','asset_content_commitment','ciphertext_blob_id','ciphertext_sha256','certification_commitment','seal_id'])('rejects protected row %s', async field => {
  const f = nativeCompleteReadFixture()
  f.set(f.assetId, bcs.struct('Field',{id:bcs.Address,name:EquipmentProtectedKeyBcs,value:EquipmentProtectedAssetBcs}), row => {
    if (field === 'scope_kind') row.value[field] = 0
    else if (field === 'ciphertext_blob_id') row.value[field] = Buffer.alloc(32,1).toString('base64url')
    else row.value[field][0] ^= 1
  })
  await expect(f.read()).rejects.toMatchObject({ code: 'NATIVE_COMPLETE_READ_INVALID' })
})
it('does not fall back from invalid static row to a valid runtime asset', async () => {
  const f = nativeCompleteReadFixture(), bad = { ...f.asset, ciphertext_sha256: Array(32).fill(9) }
  f.field(id(280), f.st('ProtectedAssetKeyV8'), EquipmentProtectedKeyBcs,
    { scope_kind: 2, scope_key: f.output.scope_key, asset_key: f.output.asset_key }, f.st('ProtectedAssetV8'), EquipmentProtectedAssetBcs, bad)
  await expect(f.read()).rejects.toMatchObject({ code: 'NATIVE_COMPLETE_READ_INVALID' })
})
it('does not substitute a public output, missing marker, missing ciphertext or poisoned DF9', async () => {
  for (const kind of ['public','marker','asset','pointer']) {
    const f = nativeCompleteReadFixture()
    if (kind === 'public') f.set(id(15), NativeArtworkOutputBcs, row => { row.protected = false })
    else f.objects.delete(kind === 'marker' ? f.markerId : kind === 'asset' ? f.assetId : f.dfId)
    await expect(f.read()).rejects.toBeInstanceOf(Error)
  }
})
it.each([id(14), id(12), id(10), id(1), id(32), id(265), id(260), id(87)])('rejects mutable readset drift %s with 409', async changedId => {
  const f = nativeCompleteReadFixture(), original = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  ;(f.client.ledgerService as any).getObject = async (req: any) => {
    const result = await original(req)
    if (req.objectId === changedId && req.readMask.paths.join() === 'object_id,version,digest') {
      return { response: { object: { ...result.response.object, version: 999n } } }
    }
    return result
  }
  await expect(f.read()).rejects.toMatchObject({ status: 409 })
})
it('propagates caller cancellation before chain reads', async () => {
  const f = nativeCompleteReadFixture(), controller = new AbortController(); controller.abort()
  await expect(f.read(controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(f.calls).toHaveLength(0)
})
it('matches only explicit public aggregator URLs; never imports configured weights/threshold or private overrides', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK','mainnet')
  vi.stubEnv('NEXT_PUBLIC_SEAL_SERVER_CONFIGS', JSON.stringify([{ objectId: id(270), weight: 99, aggregatorUrl: 'https://seal.example/' },
    { objectId: id(999), aggregatorUrl: 'https://unrelated.example/' }]))
  vi.stubEnv('SEAL_SERVER_CONFIGS', JSON.stringify([{ objectId: id(271), apiKey: 'secret', aggregatorUrl: 'https://private.example/' }]))
  const view = await nativeCompleteReadFixture().read()
  expect(view.policy.keyServers).toEqual([{ objectId: id(270), weight: 2, aggregatorUrl: 'https://seal.example/' }, { objectId: id(271), weight: 3 }])
  expect(view.policy.threshold).toBe(4); expect(JSON.stringify(view)).not.toContain('secret')
})
it.each(['https://user:secret@seal.example/', 'https://seal.example/?apiKey=secret', 'http://seal.example/', 'https://127.0.0.1/'])('rejects secret or non-public aggregator %s', url => {
  expect(() => completeReadAggregatorUrls({ NEXT_PUBLIC_SUI_NETWORK: 'mainnet', NEXT_PUBLIC_SEAL_SERVER_CONFIGS: JSON.stringify([{ objectId:id(270), aggregatorUrl:url }]) })).toThrow()
})
it('does not use testnet defaults or silently filter malformed/secret service entries', () => {
  expect(completeReadAggregatorUrls({})).toEqual(new Map())
  for (const raw of ['not json','{}',JSON.stringify([{objectId:id(270),apiKey:'secret'}]),JSON.stringify([{objectId:'bad'}])]) {
    expect(() => completeReadAggregatorUrls({ NEXT_PUBLIC_SUI_NETWORK:'mainnet', NEXT_PUBLIC_SEAL_SERVER_CONFIGS:raw })).toThrow()
  }
})
it('parses only an explicit complete Release pin and rejects extra config fields', () => {
  const f = nativeCompleteReadFixture(), env = { NEXT_PUBLIC_SUI_NETWORK: 'mainnet', NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: f.target.soulidityCallablePackageId,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: f.target.soulidityOriginalPackageId, NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify(f.target) }
  expect(readNativeReceiveTarget(env).release).toEqual(f.target.release)
  for (const release of [{...f.target.release, signer:'bad'}, {...f.target.release,callableDigest:'bad'}, {originalPackageId:id(240)}]) {
    expect(() => readNativeReceiveTarget({ ...env, NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify({...f.target,release}) })).toThrow()
  }
})
