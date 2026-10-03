import { expect, it } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { nativeEquipmentMarketAuthorityFixture } from './fixtures/native-equipment-market-authority'
import { EquipmentMakerBcs, EquipmentProtocolBcs } from '../../web/lib/animacraft/native-equipment-source-bcs'
import { equipmentProtocolCommitment } from '../../web/lib/animacraft/native-equipment-source'
import { CompleteReadCatalogBcs, CompleteReadEmptyKeyBcs } from '../../web/lib/animacraft/native-complete-read-bcs'
import { EquipmentMarketConfigBcs, EquipmentMarketReplacementBcs, EquipmentMarketRegistryBcs,
  EquipmentMarketTreasuryBcs, EquipmentMarketProtocolTreasuryBcs } from '../../web/lib/animacraft/native-equipment-market-bcs'
import { equipmentMarketCallerCapCommitment, equipmentMarketReplacementCommitment } from '../../web/lib/animacraft/native-equipment-market-authority'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`

it('authenticates exact raw Market packages, installed cap and Root companions before returning SDK inputs', async () => {
  const f = nativeEquipmentMarketAuthorityFixture(), a = await f.readAuthority()
  expect(a).toMatchObject({ current: true, recoverable: false, root: { id: f.rootId },
    protocolTreasury: { id: f.ids.protocolTreasury }, config: { runtime_caller_cap: { role: 1 } },
    sdkTarget: { marketCallablePackageId: f.marketPin.callablePackageId, rootId: f.rootId,
      registryId: f.ids.registry, treasuryId: f.ids.treasury, protocolConfigId: id(1), catalogId: f.ids.catalog,
      replacementId: f.ids.replacement, packageConfigId: f.ids.config, paymentCoinType: f.coin } })
  expect(a.mt('EquipmentListingV8')).toBe(`${f.marketPin.originalPackageId}::market_v8::EquipmentListingV8`)
})

it('does not require a Soul, Maker access, admission, Base definitions or Seal to certify an equipment market', async () => {
  const f = nativeEquipmentMarketAuthorityFixture()
  for (const n of [12, 13, 14, 15, 16, 20, 80, 81, 82, 83, 85, 87, 88]) f.objects.delete(id(n))
  expect((await f.readAuthority()).current).toBe(true)
})

it.each(['paused', 'archived', 'disabled', 'revision'])('preserves structural cancellation authority for %s without needing a current ProtocolTreasury', async mode => {
  const f = nativeEquipmentMarketAuthorityFixture()
  if (mode === 'paused' || mode === 'archived') f.set(f.rootId, EquipmentMakerBcs, root => { root.lifecycle = mode === 'paused' ? 2 : 3 })
  else f.set(id(1), EquipmentProtocolBcs, protocol => {
    if (mode === 'disabled') protocol.enabled = false
    else protocol.revision = '2'
    protocol.commitment = equipmentProtocolCommitment(protocol)
  })
  f.objects.delete(f.ids.protocolTreasury)
  const a = await f.readAuthority()
  expect(a.current).toBe(false); expect(a.recoverable).toBe(true); expect(a.protocolTreasury).toBeNull()
  expect(a.sdkTarget.protocolConfigId).toBe(id(1))
})

it.each(['digest', 'linkage', 'marker', 'duplicate-origin', 'storage'])('rejects substituted Market package %s evidence', async mode => {
  const f = nativeEquipmentMarketAuthorityFixture(), object = f.objects.get(f.marketPin.callablePackageId)
  if (mode === 'digest') object.digest = 'wrong'
  if (mode === 'linkage') object.package.linkage[1].upgradedId = id(999)
  if (mode === 'marker') object.package.typeOrigins[0].packageId = id(999)
  if (mode === 'duplicate-origin') object.package.typeOrigins.push({ ...object.package.typeOrigins[0] })
  if (mode === 'storage') object.package.storageId = id(999)
  await expect(f.readAuthority()).rejects.toThrow(/Market/)
})

it.each(['missing', 'role', 'replacement', 'hash', 'caller'])('rejects %s installed caller capability, including rehashed substitutes', async mode => {
  const f = nativeEquipmentMarketAuthorityFixture()
  f.set(f.ids.config, EquipmentMarketConfigBcs, config => {
    if (mode === 'missing') { config.runtime_caller_cap = null; return }
    const cap = config.runtime_caller_cap
    if (mode === 'role') cap.role = 0
    if (mode === 'replacement') cap.replacement_binding_id = id(999)
    if (mode === 'caller') cap.caller_callable_package_id = id(999)
    if (mode === 'hash') cap.cap_commitment[0] ^= 1
    else cap.cap_commitment = equipmentMarketCallerCapCommitment(cap)
  })
  await expect(f.readAuthority()).rejects.toThrow('caller capability mismatch')
})

it.each(['hash', 'runtime-config', 'market-binding', 'mutable'])('rejects %s replacement evidence', async mode => {
  const f = nativeEquipmentMarketAuthorityFixture()
  if (mode === 'mutable') f.objects.get(f.ids.replacement).owner.kind = 3
  else f.set(f.ids.replacement, EquipmentMarketReplacementBcs, replacement => {
    if (mode === 'hash') replacement.binding_commitment[0] ^= 1
    else {
      if (mode === 'runtime-config') replacement.runtime_config_id = id(999)
      else replacement.market_binding_commitment[0] ^= 1
      replacement.binding_commitment = equipmentMarketReplacementCommitment(replacement)
    }
  })
  await expect(f.readAuthority()).rejects.toThrow(/mismatch/)
})

it.each(['catalog-hash', 'installed-role', 'config-installation', 'registry-root', 'registry-seal', 'zero-state',
  'treasury-root', 'treasury-config', 'protocol-treasury', 'economics', 'rights'])('rejects %s authority mismatch', async mode => {
  const f = nativeEquipmentMarketAuthorityFixture()
  if (mode === 'catalog-hash') f.set(f.ids.catalog, CompleteReadCatalogBcs, row => { row.catalog_commitment[0] ^= 1 })
  if (mode === 'installed-role') f.set(f.ids.catalog, CompleteReadCatalogBcs, row => { row.role_config_commitments[4][0] ^= 1 })
  if (mode === 'config-installation') f.set(f.ids.config, EquipmentMarketConfigBcs, row => { row.installation_commitment[0] ^= 1 })
  if (mode === 'registry-root') f.set(f.ids.registry, EquipmentMarketRegistryBcs, row => { row.root_id = id(999) })
  if (mode === 'registry-seal') f.set(f.ids.registry, EquipmentMarketRegistryBcs, row => { row.sealed = false })
  if (mode === 'zero-state') f.set(f.ids.registry, EquipmentMarketRegistryBcs, row => { row.zero_state_commitment[0] ^= 1 })
  if (mode === 'treasury-root') f.set(f.ids.treasury, EquipmentMarketTreasuryBcs, row => { row.root_id = id(999) })
  if (mode === 'treasury-config') f.set(f.ids.treasury, EquipmentMarketTreasuryBcs, row => { row.package_config_id = id(999) })
  if (mode === 'protocol-treasury') f.set(f.ids.protocolTreasury, EquipmentMarketProtocolTreasuryBcs, row => { row.config_id = id(999) })
  if (mode === 'economics') f.set(f.rootId, EquipmentMakerBcs, row => { row.economics.commitment[0] ^= 1 })
  if (mode === 'rights') f.set(f.rootId, EquipmentMakerBcs, row => { row.rights.commitment[0] ^= 1 })
  await expect(f.readAuthority()).rejects.toThrow(/mismatch/)
})

it('treats another claimed protocol catalog as a current gate, while preserving the frozen return authority', async () => {
  const f = nativeEquipmentMarketAuthorityFixture()
  f.field(id(1), f.ct('protocol_config_v8', 'ProductReleaseCatalogSlotKeyV2'), CompleteReadEmptyKeyBcs,
    { dummy_field: false }, f.ct('protocol_config_v8', 'ProductReleaseCatalogSlotV2'),
    bcs.struct('ProductReleaseCatalogSlotV2', { catalog_id: bcs.Address }), { catalog_id: id(999) })
  const a = await f.readAuthority()
  expect(a.current).toBe(false); expect(a.recoverable).toBe(false)
  expect(a.config.id).toBe(f.ids.config)
})

it('rejects source object drift during the final shared readset verification', async () => {
  const f = nativeEquipmentMarketAuthorityFixture(), original = f.client.ledgerService.getObject.bind(f.client.ledgerService)
  ;(f.client.ledgerService as any).getObject = async (request: any) => {
    if (request.objectId === f.ids.registry && request.readMask.paths.length === 3) f.objects.get(f.ids.registry).version++
    return original(request)
  }
  await expect(f.readAuthority()).rejects.toThrow('refresh before acting')
})
