import { afterEach, expect, it, vi } from 'vitest'
import { prepareContentAppend } from '../../web/lib/soulidity/content-append-preparation'
import { assertContentAppendWalrusRecord, contentAppendWalrusIntent, queryContentAppend,
  type ContentAppendIntent } from '../../web/lib/soulidity/content-append-operation'
import { exportContentAppendRecovery, importContentAppendRecovery } from '../../web/lib/soulidity/content-append-recovery'
import { walrusSingleKey, type WalrusSingleRecord } from '../../web/lib/upload/walrus-single-operation'
import { sha256Hex } from '../../web/lib/upload/client-seal'
import { contentAppendPreparationFixture, contentAppendFixtureId as id } from './fixtures/content-append-preparation'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
async function fixture() {
  const f = await contentAppendPreparationFixture()
  const uploadConfig = { network: 'mainnet' as const, relayUrl: 'https://relay.example.com', wasmUrl: '/walrus/walrus_wasm@0.1.0.wasm', storageEpochs: 26 }
  const intent: ContentAppendIntent = { schema: 'soulidity.content-append-intent.v1', rebase: null, soulId: id(2), stateId: id(3),
    kindRegistryId: id(5), marketConfigId: id(6), ownershipEpoch: '0', grantId: null, readModeMask: 1,
    downloadPolicy: 'public', spriteConfigJson: null, setActive: false, autoGrantPlan: null,
    contentHash: await sha256Hex(f.params.plaintext), plaintextByteLength: f.params.plaintext.length,
    fileName: f.params.fileName, mimeType: f.params.mimeType, uploadConfig }
  f.params.scope.intentJson = JSON.stringify(intent)
  const record = await prepareContentAppend(f.params)
  const payment: WalrusSingleRecord = { schema: 'soulidity.walrus-single.v1', intent: contentAppendWalrusIntent(record),
    encoding: null, uploaded: null, approved: null, register: null, certify: null, acknowledged: false }
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUI_NETWORK: 'mainnet', NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL: uploadConfig.relayUrl,
    NEXT_PUBLIC_WALRUS_WASM_URL: uploadConfig.wasmUrl, NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: id(1),
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: id(10), NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID: id(5), NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID: id(6) })) vi.stubEnv(key, value)
  const config = { target: { soulidityOriginalPackageId: id(1), soulidityCallablePackageId: id(10) }, kindRegistryId: id(5) } as any
  const execution = { client: f.client, getAddress: vi.fn(() => null), sign: vi.fn(async () => { throw Error('No wallet action') }) }
  return { ...f, record, payment, key: walrusSingleKey(payment.intent), config, execution }
}
it.each(['network', 'owner', 'recipient', 'operationScope', 'attachmentScope', 'contentHash', 'payloadHash', 'payloadByteLength', 'storageEpochs', 'relayUrl', 'extra'])(
  'rejects a valid-shaped payment with substituted %s BEFORE query/read/sign', async key => {
    const f = await fixture(), bad = structuredClone(f.payment)
    const mutations: Record<string, unknown> = { network: 'testnet', owner: id(88), recipient: id(88), operationScope: 'other',
      attachmentScope: 'other', contentHash: 'f'.repeat(64), payloadHash: 'f'.repeat(64), payloadByteLength: 1,
      storageEpochs: 1, relayUrl: 'https://other.example.com', extra: 'not signed' }
    Object.assign(bad.intent, { [key]: mutations[key] })
    const recover = vi.fn(), read = vi.fn()
    await expect(queryContentAppend({ record: f.record, config: f.config, execution: f.execution, signal: f.controller.signal },
      { readPayment: () => bad, recover, read })).rejects.toThrow('WALRUS_PREPARATION_MISMATCH')
    expect(recover).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(f.execution.sign).not.toHaveBeenCalled()
  })
it('queries the bound snapshot without live wallet authority or rereading replaceable storage', async () => {
  const f = await fixture(), readPayment = vi.fn(() => f.payment)
  const recover = vi.fn(async (p: any) => {
    expect(p.record).toEqual(f.payment); expect(p.execution.getAddress()).toBeNull(); expect(p.execution.beforeWrite).toBeUndefined()
    await expect(p.execution.sign()).rejects.toThrow('QUERY_CANNOT_SIGN')
    f.payment.intent.payloadHash = 'f'.repeat(64)
    return { status: 'SOURCE_REQUIRED' as const, recoveryKey: f.key, record: p.record }
  })
  const result = await queryContentAppend({ record: f.record, config: f.config, execution: f.execution, signal: f.controller.signal }, { readPayment, recover })
  expect(result.recovery.status).toBe('SOURCE_REQUIRED'); expect(readPayment).toHaveBeenCalledOnce()
  expect(f.execution.getAddress).not.toHaveBeenCalled(); expect(f.execution.sign).not.toHaveBeenCalled()
})
it('rejects a substituted query result before treating its status as evidence', async () => {
  const f = await fixture(), bad = structuredClone(f.payment); bad.intent.payloadHash = 'f'.repeat(64)
  await expect(queryContentAppend({ record: f.record, config: f.config, execution: f.execution, signal: f.controller.signal, payment: f.payment },
    { recover: async () => ({ status: 'SOURCE_REQUIRED', recoveryKey: f.key, record: bad }) })).rejects.toThrow('WALRUS_PREPARATION_MISMATCH')
})
it('exports and cold-imports real signed encrypted preparation with the complete payment record, without adopting it', async () => {
  const f = await fixture(), read = vi.fn(() => f.payment)
  const text = await exportContentAppendRecovery(f.record, f.client, read, async () => ({ history: [], pending: null }))
  expect(text).not.toContain('private memory:'); expect(read).toHaveBeenCalledWith(f.key)
  const imported = await importContentAppendRecovery(text, f.client)
  expect(imported.record).toEqual(f.record); expect(imported.payment).toEqual(f.payment)
  const readPayment = vi.fn(() => { throw Error('Fresh device has no local storage') })
  const recover = vi.fn(async (p: any) => ({ status: 'SOURCE_REQUIRED' as const, recoveryKey: f.key, record: p.record }))
  const result = await queryContentAppend({ ...imported, config: f.config, execution: f.execution, signal: f.controller.signal }, { readPayment, recover })
  expect(result.recovery.status).toBe('SOURCE_REQUIRED'); expect(readPayment).not.toHaveBeenCalled(); expect(f.sign).toHaveBeenCalledOnce()
  expect(f.decryptCall).not.toHaveBeenCalled(); expect(f.execution.sign).not.toHaveBeenCalled()
})
it('a null imported WAL never falls through to unrelated local storage', async () => {
  const f = await fixture(), text = await exportContentAppendRecovery(f.record, f.client, () => null, async () => ({ history: [], pending: null }))
  const imported = await importContentAppendRecovery(text, f.client), readPayment = vi.fn(), recover = vi.fn()
  const result = await queryContentAppend({ ...imported, config: f.config, execution: f.execution, signal: f.controller.signal }, { readPayment, recover })
  expect(result.recovery.status).toBe('NONE'); expect(readPayment).not.toHaveBeenCalled(); expect(recover).not.toHaveBeenCalled()
})
it.each(['signature', 'payment', 'extra', 'noncanonical'])('rejects imported %s without signing or changing local records', async mode => {
  const f = await fixture(), text = await exportContentAppendRecovery(f.record, f.client, () => f.payment, async () => ({ history: [], pending: null }))
  const input = JSON.parse(text)
  if (mode === 'signature') input.preparation.scope.versionIndex = '0'
  if (mode === 'payment') input.payment.intent.payloadHash = 'f'.repeat(64)
  if (mode === 'extra') input.dek = 'unrequested'
  await expect(importContentAppendRecovery(mode === 'noncanonical' ? `${text}\n` : JSON.stringify(input), f.client)).rejects.toThrow()
  expect(f.sign).toHaveBeenCalledOnce(); expect(f.decryptCall).not.toHaveBeenCalled()
})
it('payment validation returns a detached snapshot', async () => {
  const f = await fixture(), copy = assertContentAppendWalrusRecord(f.record, f.payment)
  f.payment.intent.owner = id(88); expect(copy.intent.owner).toBe(f.record.scope.author)
})
