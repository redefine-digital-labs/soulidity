import { afterEach, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { contentMutationTransactionFixture } from './fixtures/content-mutation-transaction'
import { SoulPublicKioskBcs, SoulPublicMarketConfigBcs, SOUL_PUBLIC_USDC_TYPE } from '@soulidity/sdk'
import { normalizeStructTag, toBase58, fromBase64, toBase64 } from '@mysten/sui/utils'
import { EncryptedObject } from '../../web/node_modules/@mysten/seal/dist/index.mjs'
import { EnvelopeConfigField } from './fixtures/content-envelope'
import { appendWireReplacer } from './fixtures/content-append-browser-runtime'
import { createMutationUiRuntime } from './fixtures/content-mutation-ui-runtime'
afterEach(() => vi.restoreAllMocks())
it.each(['delete', 'set-active', 'clear-active', 'purge', 'memory-delete', 'memory-purge'] as const)('exports original-page %s with real signed bytes and raw readback', async scenario => {
  const memory = scenario.startsWith('memory-')
  const action = scenario.replace('memory-','') as 'delete'|'purge'|'set-active'|'clear-active'
  const f = await contentMutationTransactionFixture({ action, memory })
  const { rows, tables } = f.domain(), deployment = { originalPackageId: f.plan.deployment.originalPackageId, chainIdentifier: '35834a8a' }
  // Match the transaction fixture's translated package domain. This fixture
  // envelope is structural metadata only, not a decryption acceptance sample.
  const envelopeRow = rows.get(f.raw.envelopeFieldId)!
  const envelopeField = EnvelopeConfigField.parse(envelopeRow.contents.value)
  const envelope = JSON.parse(new TextDecoder().decode(new Uint8Array(envelopeField.value)))
  const encrypted = EncryptedObject.parse(fromBase64(envelope.sidecar.encryptedDek))
  encrypted.packageId = deployment.originalPackageId
  envelope.sidecar.sealPackageId = deployment.originalPackageId
  envelope.sidecar.encryptedDek = toBase64(EncryptedObject.serialize(encrypted).toBytes())
  envelopeField.value = [...new TextEncoder().encode(JSON.stringify(envelope))]
  envelopeRow.contents.value = EnvelopeConfigField.serialize(envelopeField).toBytes()
  const put = (id: string, type: string, bytes: Uint8Array) => rows.set(id, { objectId: id, objectType: normalizeStructTag(type),
    version: 1n, digest: toBase58(new Uint8Array(32).fill(1)), owner: { kind: 3, version: 1n }, contents: { value: bytes } })
  put(f.raw.state.current_kiosk_id, '0x2::kiosk::Kiosk', SoulPublicKioskBcs.serialize({ id: f.raw.state.current_kiosk_id,
    profits: '0', owner: f.author, item_count: 1, allow_extensions: false }).toBytes())
  put(f.plan.deployment.marketConfigId, `${deployment.originalPackageId}::market::MarketConfigV2`, SoulPublicMarketConfigBcs.serialize({
    id: f.plan.deployment.marketConfigId, version: '2', legacy_config_id: '0x0', fee_recipient: '0x1', platform_fee_bps: 250,
    primary_enabled: true, secondary_enabled: true }).toBytes())
  const data = { rows: [...rows], tables: [...tables], attributes:f.attributes, prepared: await f.adapter.prepare(f.plan), signed: f.record,
    ledger: await f.raw.client.ledgerService.getTransaction({ digest: f.record.packet.digest }), historical: [...f.rows],
    deployment, listingDeployment: { ...deployment, marketConfigId: f.plan.deployment.marketConfigId, paymentCoinType: SOUL_PUBLIC_USDC_TYPE } }
  const runtime = await createMutationUiRuntime(data)
  const before = await runtime.detail()
  expect(before.contentVersions.filter(v => v.kind === 3)).toHaveLength(2)
  const adapter = runtime.adapter({ preflight: f.preflight })
  await adapter.broadcast(f.record)
  expect((await adapter.query(f.record)).status).toBe('SUCCEEDED')
  const after = await runtime.detail()
  if (action === 'delete' || action === 'purge') expect(after.contentVersions.find(v => v.kind === (memory?1:3) && v.versionIndex === '0')).toMatchObject({deleted:true,purged:action==='purge'})
  else expect(after.activeSpriteVersionIndex).toBe(action === 'clear-active' ? null : '0')
  if(memory) expect(after.activeSpriteVersionIndex).toBe(before.activeSpriteVersionIndex)
  if (process.env.S3_CONTENT_BROWSER_DIR) await writeFile(path.join(process.env.S3_CONTENT_BROWSER_DIR, `mutation-${scenario}.json`), JSON.stringify(data, appendWireReplacer))
})
