import { afterEach, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { contentAppendOperationFixture } from './fixtures/content-append-operation'
import { appendWireReplacer, appendWireReviver, createContentAppendBrowserRuntime } from './fixtures/content-append-browser-runtime'
import { SoulPublicKioskBcs, SoulPublicMarketConfigBcs, SOUL_PUBLIC_USDC_TYPE } from '@soulidity/sdk'
import { normalizeStructTag, toBase58 } from '@mysten/sui/utils'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
it('exports and replays the controlled Memory raw graph for the original browser append', async () => {
  const f = await contentAppendOperationFixture({ memory: true })
  const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
  const put = (objectId: string, objectType: string, bytes: Uint8Array) => f.raw.rows.set(objectId, { objectId,
    objectType: normalizeStructTag(objectType), version: 1n, digest: toBase58(new Uint8Array(32).fill(1)),
    owner: { kind: 3, version: 1n }, contents: { value: bytes } })
  put(f.raw.state.current_kiosk_id, '0x2::kiosk::Kiosk', SoulPublicKioskBcs.serialize({ id: f.raw.state.current_kiosk_id,
    profits: '0', owner: f.scope.author, item_count: 1, allow_extensions: false }).toBytes())
  put(f.intent.marketConfigId, `${f.scope.originalPackageId}::market::MarketConfigV2`, SoulPublicMarketConfigBcs.serialize({
    id: f.intent.marketConfigId, version: '2', legacy_config_id: id(0), fee_recipient: id(7001), platform_fee_bps: 250,
    primary_enabled: true, secondary_enabled: true }).toBytes())
  const deployment = { originalPackageId: f.scope.originalPackageId, chainIdentifier: f.raw.deployment.chainIdentifier }
  const data = { rows: [...f.raw.rows], tables: [...f.raw.tables], state: f.raw.state, soul: f.raw.soul,
    content: f.raw.content, dynamicField: f.raw.dynamicField, config: f.config, sealConfig: f.record.sealConfig,
    attributes: f.attributes, result: f.result, initialSnapshot: f.proof.snapshot, accessConfig:f.raw.config, blob:f.raw.blob,
    deployment, listingDeployment: { ...deployment, marketConfigId: f.intent.marketConfigId, paymentCoinType: SOUL_PUBLIC_USDC_TYPE },
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => [
      'NEXT_PUBLIC_SUI_NETWORK', 'NEXT_PUBLIC_SEAL_THRESHOLD', 'NEXT_PUBLIC_SEAL_SESSION_TTL_MIN', 'NEXT_PUBLIC_SEAL_SERVER_CONFIGS',
      'NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS', 'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID',
      'NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID', 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID', 'NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL',
      'NEXT_PUBLIC_WALRUS_WASM_URL',
    ].includes(key))) }
  const json = JSON.stringify(data, appendWireReplacer)
  const runtime = await createContentAppendBrowserRuntime(JSON.parse(json, appendWireReviver))
  try {
    expect((await runtime.read()).snapshot).toEqual(f.proof.snapshot)
    expect((await runtime.detail()).contentVersions.filter(v => v.kind === 1)).toHaveLength(1)
    const record = await runtime.prepare({ ...f.crypto.params, scope: f.scope })
    const result = await runtime.run({ record, config: runtime.config,
      execution: { ...f.execution, client: runtime.client }, signal: f.crypto.controller.signal, confirmQuote: async () => true })
    expect(result.version).toMatchObject({ kind: 1, name: 'default', versionIndex: '1' })
    expect(runtime.latest().record).toBe(record)
    expect(runtime.stats).toMatchObject({ preparations: 1, uploads: 1, acknowledgements: 1, completed: 1 })
    expect((await runtime.detail()).contentVersions.find(v => v.kind === 1 && v.versionIndex === '1')).toMatchObject({ envelopeStatus: 'VERIFIED' })
    const opened = await runtime.open({ request:{...runtime.soulIds,kind:1,name:'default',versionIndex:'1',
      viewerAddress:runtime.account.address,config:runtime.accessConfig},sealConfig:runtime.sealConfig,
      client:runtime.client,sealClient:runtime.client,signal:new AbortController().signal,
      getAddress:()=>runtime.account.address,signPersonalMessage:runtime.signPersonalMessage })
    expect(new TextDecoder().decode(opened.bytes)).toBe(new TextDecoder().decode(f.crypto.params.plaintext))
    opened.bytes.fill(0)
    if (process.env.S3_CONTENT_BROWSER_DIR) await writeFile(path.join(process.env.S3_CONTENT_BROWSER_DIR, 'append-fixture.json'), json)
  } finally { runtime.dispose() }
})
