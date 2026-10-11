import { vi } from 'vitest'
import { deriveDynamicFieldID, fromHex, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { SoulPublicMarketConfigBcs, SOUL_PUBLIC_USDC_TYPE } from '@soulidity/sdk'
import { browserContentAccessFixture } from './browser-content-access-raw'
import { accessId } from './soul-access-transaction'

/** Reuses the repository's complete public Soul/pointer/content/table fixture,
 * translating its legacy 0x6 package to avoid aliasing Sui Clock. */
export function soulAccessRawFixture() {
  const raw = browserContentAccessFixture(), oldPkg = raw.deployment.originalPackageId, pkg = accessId(7001)
  const deployment = { ...raw.deployment, originalPackageId: pkg, callablePackageId: accessId(7004),
    marketConfigId: accessId(7000), paymentCoinType: SOUL_PUBLIC_USDC_TYPE }
  const market = { id: deployment.marketConfigId, version: '2', legacy_config_id: accessId(7002), fee_recipient: accessId(7003),
    platform_fee_bps: 250, primary_enabled: true, secondary_enabled: true }
  const origins = [['soul', 'Soul'], ['soul', 'SoulState'], ['soul', 'ActiveGrantSlot'], ['grant', 'SoulGrant'],
    ['paid_access', 'SoulPaidAccessList'], ['paid_access', 'KindPaidConfig'], ['paid_access', 'KindPaidEntry'],
    ['kind_registry', 'KindRegistry'], ['market', 'MarketConfigV2']]
  const packageRow = { objectId: deployment.callablePackageId, version: 1n, digest: toBase58(new Uint8Array(32).fill(9)), owner: { kind: 4 },
    package: { originalId: pkg, storageId: deployment.callablePackageId, version: 1n, linkage: [],
      modules: [...new Set(origins.map(([name]) => name))].map(name => ({ name, contents: new Uint8Array([1, 2, 3, 4, 5]) })),
      typeOrigins: origins.map(([moduleName, datatypeName]) => ({ moduleName, datatypeName, packageId: pkg })) } }
  const extras = new Map<string, any>()
  function domain() {
    const rows = structuredClone(raw.rows), tables = structuredClone(raw.tables)
    const translate = (type: string) => type.replaceAll(`${oldPkg}::`, `${pkg}::`)
    for (const row of rows.values()) if (row.objectType) row.objectType = translate(row.objectType)
    for (const fields of tables.values()) for (const field of fields) {
      const old = field.fieldId; field.name.name = translate(field.name.name); field.valueType = translate(field.valueType)
      const parent = rows.get(old).owner.address
      field.fieldId = deriveDynamicFieldID(parent, field.name.name, field.name.value)
      const row = rows.get(old); rows.delete(old); row.objectId = field.fieldId; row.contents.value.set(fromHex(field.fieldId), 0); rows.set(field.fieldId, row)
    }
    rows.set(packageRow.objectId, structuredClone(packageRow))
    rows.set(market.id, { objectId: market.id, objectType: normalizeStructTag(`${pkg}::market::MarketConfigV2`), version: 1n,
      digest: toBase58(new Uint8Array(32).fill(8)), owner: { kind: 3, version: 1n }, contents: { value: SoulPublicMarketConfigBcs.serialize(market).toBytes() } })
    for (const [id, row] of extras) rows.set(id, structuredClone(row))
    return { rows, tables }
  }
  const get = raw.get.mockImplementation((async ({ objectId }: any) => ({ response: { object: domain().rows.get(objectId) } })) as never)
  raw.batch.mockImplementation((async ({ requests }: any) => {
    const rows = domain().rows
    return { response: { objects: requests.map(({ objectId }: any) => ({ result: rows.has(objectId)
      ? { oneofKind: 'object', object: rows.get(objectId) } : { oneofKind: 'error', error: { code: 5 } } })) } }
  }) as never)
  raw.list.mockImplementation((async ({ parent }: any) => ({ response: { dynamicFields: domain().tables.get(parent) ?? [] } })) as never)
  const listOwned = vi.spyOn(raw.client.stateService, 'listOwnedObjects').mockResolvedValue({ response: { objects: [] } } as never)
  return { raw, deployment, market, packageRow, extras, domain, get, listOwned, client: raw.client,
    params: { client: raw.client, deployment, soulId: raw.soul.id, stateId: raw.state.id, contentId: raw.content.id,
      paidAccessListId: raw.paid.id, author: raw.state.current_owner } }
}
