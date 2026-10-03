// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { SOUL_PUBLIC_USDC_TYPE } from '@soulidity/sdk'
import { usePublish, type PublishParams } from '../../web/lib/hooks/use-publish'
import { useImport } from '../../web/lib/hooks/use-import'
import { useWrapPublish } from '../../web/lib/hooks/use-wrap-publish'
import { useCollectionPublish } from '../../web/lib/hooks/use-collection-publish'

const m = vi.hoisted(() => ({ account: { address: '0x' + '11'.repeat(32) }, wallet: {}, client: {},
  mode: 'ORDINARY' as 'ORDINARY' | 'IMPORTED' | 'JOINED' | 'COLLECTION', saved: null as any, head: null as any, read: vi.fn(), prepare: vi.fn(), run: vi.fn(), query: vi.fn(), kiosk: vi.fn(), bind: vi.fn(), sign: vi.fn(), archive: vi.fn(), collection: vi.fn() }))
vi.mock('../../web/lib/soulidity/collection-authoring-flow', () => ({ advanceCollectionAuthoring: (input: any) => m.collection(input) }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => m.account, useCurrentWallet: () => ({ currentWallet: m.wallet }) }))
vi.mock('../../web/lib/hooks/use-wallet-sign', () => ({ useWalletSign: () => ({ suiWallet: m.account, suiGrpcClient: m.client,
  getWalletAddress: () => m.account.address, signTransaction: m.sign, signPersonalMessage: vi.fn() }) }))
const id = (n: number) => '0x' + n.toString(16).padStart(64, '0')
vi.mock('../../web/lib/hooks/use-collection-buy', () => ({ getCollectionBuyTarget: () => ({
  chainIdentifier: '35834a8a', originalPackageId: id(1), callablePackageId: id(1), callableDigest: '1'.repeat(32),
  marketConfigId: id(2), kioskRegistryId: id(3), personalKioskTypePackageId: id(4),
  paymentCoinType: SOUL_PUBLIC_USDC_TYPE, collectionTransferPolicyId: id(6), kioskPackageId: id(7),
}) }))
vi.mock('@soulidity/sdk', async original => ({ ...await original<any>(), getRequiredSoulidityEnv: (name: string) => name.includes('KIND') ? id(8) : id(9),
  preflightCollectionBindTarget: (input: any) => m.bind(input) }))
vi.mock('../../web/lib/upload/client-upload', () => ({ createWalrusClient: async () => ({}) }))
vi.mock('../../web/lib/upload/walrus-batch-store', () => ({ browserWalrusBatchStore: () => ({}), WALRUS_BATCH_STORE_CHANGED: 'test-upload-changed' }))
vi.mock('../../web/lib/soulidity/browser-content-open', () => ({ getBrowserContentSealConfig: () => ({}) }))
vi.mock('../../web/lib/soulidity/soul-authoring-store', () => ({ browserSoulAuthoringStore: () => ({ read: m.read }) }))
vi.mock('../../web/lib/soulidity/soul-authoring-preparation', () => ({ prepareSoulAuthoring: (input: any) => m.prepare(input) }))
vi.mock('../../web/lib/soulidity/soul-authoring-journal', () => ({ browserSoulAuthoringPacketJournal: () => ({ read: async () => m.head }) }))
vi.mock('../../web/lib/soulidity/soul-authoring-wallet', () => ({ createSoulAuthoringWallet: () => ({ run: m.run, query: m.query }) }))
vi.mock('../../web/lib/soulidity/soul-authoring-kiosk', () => ({ resolveSoulAuthoringKiosk: (input: any) => m.kiosk(input) }))
vi.mock('../../web/lib/soulidity/soul-authoring-completion', () => ({ soulAuthoringCompletionKey: () => 'completion-key',
  readSoulAuthoringCompletion: async () => null, archiveCompletedSoulAuthoring: (...args: any[]) => m.archive(...args) }))

let root: Root, host: HTMLDivElement, current: ReturnType<typeof usePublish>
let imported: ReturnType<typeof useImport>
let wrapped: ReturnType<typeof useWrapPublish>
let collection: ReturnType<typeof useCollectionPublish>
function Harness() {
  if (m.mode === 'COLLECTION') { collection = useCollectionPublish(async () => true); current = collection }
  else if (m.mode === 'JOINED') { wrapped = useWrapPublish(async () => true); current = wrapped as unknown as ReturnType<typeof usePublish> }
  else if (m.mode === 'IMPORTED') { imported = useImport(async () => true); current = imported }
  else current = usePublish(async () => true)
  return <div>{current.loadingRecovery ? 'loading' : current.status}</div>
}
const draft = (): PublishParams => ({ name: 'Original Soul', description: 'Ordinary create', tags: ['one', 'two'], creatorRoyaltyBps: 500,
  cover: new File(['cover'], 'cover.png'), character: new File(['character'], 'SOUL.md'), memory: new File(['memory'], 'MEMORY.md'),
  skills: null, collectionBindTarget: { collectionOnChainId: id(10) }, listOnPublish: true, listingPriceAtomic: '1234567' })
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  m.account = { address: '0x' + '11'.repeat(32) }; m.saved = null; m.head = null
  m.mode = 'ORDINARY'
  m.collection.mockReset().mockResolvedValue({ result: { txDigest: 'last-chunk', collectionOnChainId: id(40), rightOnChainId: id(41),
    soulCount: 2, currentSoulSupply: 2, maxSoulSupply: '100', listingStatus: 'listed' }, pending: null })
  m.read.mockReset().mockImplementation(async () => m.saved)
  m.kiosk.mockReset().mockResolvedValue({ kind: 'NEW', kioskId: null, capId: null })
  m.bind.mockReset().mockImplementation(async ({ deployment }: any) => {
    expect(Object.keys(deployment).sort()).toEqual(['originalPackageId', 'chainIdentifier', 'marketConfigId', 'paymentCoinType', 'kioskRegistryId', 'personalKioskTypePackageId'].sort())
  })
  m.prepare.mockReset().mockImplementation(async ({ request }: any) => (m.saved = { manifest: { request } }))
  m.archive.mockReset().mockImplementation(async () => { m.saved = null; m.head = null; return 'completion-key' })
  m.query.mockReset().mockResolvedValue({ status: 'FAILED' })
  m.run.mockReset().mockImplementation(async (step: any) => {
    m.head = { plan: { step }, packet: { digest: step.kind, bytes: `${step.kind}-bytes` } }
    return { status: 'SUCCEEDED', record: m.head, receipt: { business: {
      stage: step.kind, transactionDigest: step.kind, mints: step.kind === 'MINT' ? [{ mintIndex: 0,
        soulId: id(20), stateId: id(21), contentId: id(22), listingId: id(23) }] : [],
    } } }
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(<Harness />) })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })
it('original Collection wrapper saves the complete batch before advancement and resumes without original Files', async () => {
  m.mode = 'COLLECTION'; await act(async () => root.render(<Harness />))
  await act(async () => { await collection.publish({ name: 'Collection', description: 'Original collection',
    coverImageFile: new File(['cover'], 'cover.png'), extraRoyaltyBps: 500, tradeable: true, maxSupply: 100,
    collectionRightListing: { priceAtomic: '9007199254740993' }, souls: [
      { name: 'A', description: 'First', tags: [], creatorRoyaltyBps: 300 },
      { name: 'B', description: 'Second', tags: [], creatorRoyaltyBps: 400 }] }) })
  expect(collection.error).toBeNull(); expect(collection.status).toBe('done')
  expect(m.prepare.mock.calls[0][0].request.collection.listingPriceAtomic).toBe('9007199254740993')
  expect(m.prepare.mock.invocationCallOrder[0]).toBeLessThan(m.collection.mock.invocationCallOrder[0])
  expect(collection.syncData).toMatchObject({ soulCount: 2, collectionOnChainId: id(40), authoringCompletionKey: 'completion-key' })
  m.prepare.mockClear()
  await act(async () => { await collection.resume() })
  expect(m.prepare).not.toHaveBeenCalled()
  await act(async () => { await collection.startAnother('last-chunk', 'completion-key') })
  expect(m.archive).toHaveBeenCalledOnce()
})
it('Wrap freezes external identity, preserves empty display fields and maps encrypted files without a fabricated cover', async () => {
  m.mode = 'JOINED'; await act(async () => root.render(<Harness />))
  const files = draft()
  await act(async () => { await wrapped.publish({ nft: { objectId: id(44), objectType: `${id(45)}::nft::NFT`,
    name: 'Original NFT', description: null, imageUrl: null }, charFile: files.character, memoryFile: files.memory,
    skillsFile: new File(['skill'], 'SKILL.md'), royalty: 500 }) })
  expect(wrapped.error).toBeNull(); expect(wrapped.status).toBe('done')
  const input = m.prepare.mock.calls[0][0], mint = input.request.mints[0]
  expect(mint).toMatchObject({ kind: 'JOINED', description: '', image: { kind: 'URL', url: '' },
    originRef: `sui:${id(44)}`, source: { objectId: id(44), objectType: `${id(45)}::nft::NFT` },
    publicPreview: { tags: [], previewImages: [] }, listingPriceAtomic: null })
  expect(mint.slots.map((s: any) => s.fileIndex)).toEqual([0, 1, 2])
  expect(input.files.map((f: any) => f.uploadType)).toEqual(['encrypted', 'encrypted', 'encrypted'])
  expect(input.files.map((f: any) => f.file.type)).toEqual(['text/markdown', 'text/markdown', 'text/markdown'])
  expect(wrapped.result).toMatchObject({ provenanceKind: 'personal-join', originRef: `sui:${id(44)}` })
  m.prepare.mockClear(); m.run.mockClear()
  await act(async () => { await wrapped.resume() })
  expect(m.prepare).not.toHaveBeenCalled(); expect(m.run.mock.calls.map(([s]) => s.kind)).toEqual(['MINT'])
  m.mode = 'ORDINARY'; await act(async () => root.render(<Harness />))
  await act(async () => { await current.resume() })
  expect(current.error).toContain('another authoring flow')
})
it('maps the original create fields, saves identity before register, then returns the proved Soul/bind/list result', async () => {
  await act(async () => { await current.publish(draft()) })
  expect(current.error).toBeNull(); expect(current.status).toBe('done')
  const input = m.prepare.mock.calls[0][0], mint = input.request.mints[0]
  expect(mint).toMatchObject({ name: 'Original Soul', creatorRoyaltyBps: 500, listingPriceAtomic: '1234567', image: { kind: 'FILE', fileIndex: 0 } })
  expect(mint.contentObjectId).toMatch(/^0x[0-9a-f]{64}$/)
  expect(mint.slots).toEqual([expect.objectContaining({ name: 'soul', fileIndex: 1, readModeMask: 3, downloadPolicy: 'public' }),
    expect.objectContaining({ name: 'default', fileIndex: 2, readModeMask: 3, downloadPolicy: 'public' })])
  expect(input.files.map((f: any) => f.uploadType)).toEqual(['public', 'encrypted', 'encrypted'])
  expect(m.prepare.mock.invocationCallOrder[0]).toBeLessThan(m.run.mock.invocationCallOrder[0])
  expect(m.run.mock.calls.map(([step]) => step.kind)).toEqual(['REGISTER', 'MINT'])
  expect(m.run.mock.calls[1][1]).toEqual({ startNew: true })
  expect(current.publishData).toMatchObject({ soulOnChainId: id(20), memoryOnChainId: id(22), collectionOnChainId: id(10),
    listingStatus: 'listed', listedPriceAtomic: '1234567', txDigest: 'MINT', listingTxDigest: 'MINT', collectionAddTxDigest: 'MINT' })
})
it('cold query uses the saved mint without regenerating identity or requesting another registration', async () => {
  await act(async () => { await current.publish(draft()) })
  m.prepare.mockClear(); m.run.mockClear(); m.kiosk.mockClear()
  await act(async () => { await current.query() })
  expect(m.prepare).not.toHaveBeenCalled(); expect(m.kiosk).not.toHaveBeenCalled()
  expect(m.run).toHaveBeenCalledOnce(); expect(m.run.mock.calls[0][1]).toEqual({ queryOnly: true })
  expect(current.status).toBe('done')
})
it('Import preserves source/provenance, files and preview in the same durable payment flow', async () => {
  m.mode = 'IMPORTED'; await act(async () => root.render(<Harness />))
  const { collectionBindTarget, listOnPublish, listingPriceAtomic, ...files } = draft()
  await act(async () => { await imported.importSoul({ ...files, originRef: 'sha256:original-file-hash' }) })
  expect(current.status).toBe('done')
  const request = m.prepare.mock.calls[0][0].request
  expect(request.mints[0]).toMatchObject({ kind: 'IMPORTED', originRef: 'sha256:original-file-hash', source: null,
    publicPreview: { tags: ['one', 'two'], previewImages: [{ kind: 'FILE', fileIndex: 0 }] }, listingPriceAtomic: null })
  expect(request.bindCollectionId).toBeNull()
  expect(request.mints[0].slots).toEqual([expect.objectContaining({ name: 'soul', readModeMask: 3, downloadPolicy: 'public' }),
    expect.objectContaining({ name: 'default', readModeMask: 3, downloadPolicy: 'public' })])
  expect(imported.importData).toMatchObject({ provenanceKind: 'imported', originRef: 'sha256:original-file-hash', soulOnChainId: id(20), authoringCompletionKey: 'completion-key' })
  m.prepare.mockClear(); m.run.mockClear()
  await act(async () => { await imported.query() })
  expect(m.prepare).not.toHaveBeenCalled(); expect(m.run).toHaveBeenCalledOnce()
  expect(m.run.mock.calls[0][1]).toEqual({ queryOnly: true })
  expect(imported.importData?.originRef).toBe('sha256:original-file-hash')
})
it('Import with no origin cannot prepare or pay', async () => {
  m.mode = 'IMPORTED'; await act(async () => root.render(<Harness />))
  const { collectionBindTarget, listOnPublish, listingPriceAtomic, ...files } = draft()
  await act(async () => { await imported.importSoul({ ...files, originRef: '' }) })
  expect(current.status).toBe('error'); expect(m.prepare).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled()
})
it('Import cannot query, resume or archive an ordinary creation under the same wallet', async () => {
  await act(async () => { await current.publish(draft()) })
  m.mode = 'IMPORTED'; await act(async () => root.render(<Harness />)); m.run.mockClear()
  await act(async () => { await imported.query() })
  expect(current.error).toContain('another authoring flow')
  await act(async () => { await imported.resume() })
  expect(m.run).not.toHaveBeenCalled()
  let reset = true
  await act(async () => { reset = await imported.startAnother('MINT', 'completion-key') })
  expect(reset).toBe(false); expect(m.archive).not.toHaveBeenCalled()
})
it('declining fee review retains the creation without presenting a chain failure or internal code', async () => {
  m.run.mockRejectedValueOnce(Error('SOUL_AUTHORING_PACKET_USER_DECLINED_PACKET'))
  await act(async () => { await current.publish(draft()) })
  expect(current.status).toBe('idle'); expect(current.recovery).toBe(m.saved)
  expect(current.error).toBe('Transaction review cancelled. Your saved creation is kept. Resume when ready.')
  expect(current.retryPacket).toBeNull()
})
async function observeFailure(status = 'FAILED') {
  await act(async () => { await current.publish(draft()) })
  m.run.mockResolvedValueOnce({ status, record: m.head })
  await act(async () => { await current.query() })
  m.run.mockClear(); m.prepare.mockClear(); m.kiosk.mockClear()
}
it('explicit failed mint retry keeps its content identity and does not repeat storage registration', async () => {
  await observeFailure()
  const content = m.saved.manifest.request.mints[0].contentObjectId
  expect(current.retryPacket).toEqual({ digest: 'MINT', bytes: 'MINT-bytes' })
  await act(async () => { await current.retryFailed() })
  expect(m.query).toHaveBeenCalledOnce(); expect(m.prepare).not.toHaveBeenCalled()
  expect(m.run).toHaveBeenCalledOnce()
  expect(m.run.mock.calls[0][0].kind).toBe('MINT')
  expect(m.run.mock.calls[0][1]).toEqual({ startNew: true, expectedPacket: { digest: 'MINT', bytes: 'MINT-bytes' } })
  expect(m.saved.manifest.request.mints[0].contentObjectId).toBe(content)
  expect(current.status).toBe('done')
})
it.each(['MISSING', 'PENDING'])('an observed %s never offers a replacement', async status => {
  await observeFailure(status)
  expect(current.retryPacket).toBeNull()
  await act(async () => { await current.retryFailed() })
  expect(m.run).not.toHaveBeenCalled(); expect(m.query).not.toHaveBeenCalled()
})
it.each(['SUCCEEDED', 'PENDING', 'MISSING'])('retry refuses a failure that now queries as %s', async status => {
  await observeFailure()
  m.query.mockResolvedValueOnce({ status })
  await act(async () => { await current.retryFailed() })
  expect(current.error).toContain('finalized failure is required')
  expect(m.run).not.toHaveBeenCalled(); expect(m.kiosk).not.toHaveBeenCalled()
})
it('retry refuses a changed packet before querying or signing', async () => {
  await observeFailure()
  m.head = { ...m.head, packet: { bytes: 'other', digest: 'other' } }
  await act(async () => { await current.retryFailed() })
  expect(current.error).toContain('selected transaction changed')
  expect(m.query).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled()
})
it('retirement is bound to the packet shown before a different tab changes the head', async () => {
  await observeFailure('MISSING')
  m.head = { ...m.head, packet: { bytes: 'other', digest: 'other' } }
  await act(async () => { await current.retireExpired() })
  expect(current.error).toContain('selected transaction changed')
  expect(m.run).not.toHaveBeenCalled()
})
it('explicit expiry check retains the retired packet, and retry re-proves it without registering again', async () => {
  await observeFailure('MISSING')
  m.run.mockImplementationOnce(async (_step, options) => {
    expect(options).toEqual({ retireExpired: true, expectedPacket: { bytes: 'MINT-bytes', digest: 'MINT' } })
    m.head = { ...m.head, packet: { ...m.head.packet, phase: 'RETIRED' } }
    return { status: 'MISSING', record: m.head }
  })
  await act(async () => { await current.retireExpired() })
  expect(current.retryPacket?.retired).toBe(true)
  m.query.mockResolvedValueOnce({ status: 'MISSING' }); m.run.mockClear()
  await act(async () => { await current.retryFailed() })
  expect(m.query).toHaveBeenCalledOnce(); expect(m.run).toHaveBeenCalledOnce()
  expect(m.run.mock.calls[0][0].kind).toBe('MINT')
  expect(m.run.mock.calls[0][1].startNew).toBe(true)
  expect(m.prepare).not.toHaveBeenCalled(); expect(current.status).toBe('done')
})
it('a storage-change refresh removes a retry selection belonging to the previous packet', async () => {
  await observeFailure()
  m.head = { ...m.head, packet: { bytes: 'other', digest: 'other' } }
  await act(async () => { window.dispatchEvent(new Event('test-upload-changed')) })
  expect(current.retryPacket).toBeNull(); expect(current.txDigest).toBe('other')
  await act(async () => { await current.retryFailed() })
  expect(m.run).not.toHaveBeenCalled()
})
it('storage refresh clears completed progress only when the saved creation identity changes', async () => {
  m.mode = 'COLLECTION'; await act(async () => root.render(<Harness />))
  m.collection.mockImplementation(async ({ progress }: any) => {
    progress(10, 23); return { result: null, pending: null }
  })
  await act(async () => { await collection.publish({ name: 'Collection', description: 'Saved progress',
    coverImageFile: draft().cover, extraRoyaltyBps: 500, tradeable: true, maxSupply: 100,
    souls: Array.from({ length: 23 }, (_, i) => ({ name: `Soul ${i}`, description: 'Saved row', tags: [], creatorRoyaltyBps: 500 })) }) })
  expect(current.progress.mintedSouls).toBe(10)
  await act(async () => { window.dispatchEvent(new Event('test-upload-changed')) })
  expect(current.progress.mintedSouls).toBe(10)
  m.saved = { ...m.saved, manifest: { ...m.saved.manifest, request: { ...m.saved.manifest.request, operationId: '2'.repeat(32) } } }
  await act(async () => { window.dispatchEvent(new Event('test-upload-changed')) })
  expect(current.recovery?.manifest.request.operationId).toBe('2'.repeat(32))
  expect(current.progress.mintedSouls).toBe(0)
  expect(current.collectionData).toBeNull()
})
it('explicit failed registration retry progresses to mint without preparing another identity', async () => {
  m.run.mockImplementationOnce(async (step: any) => {
    m.head = { plan: { step }, packet: { digest: 'failed-register', bytes: 'register-bytes' } }
    return { status: 'FAILED', record: m.head }
  })
  await act(async () => { await current.publish(draft()) })
  const original = m.saved
  expect(current.retryPacket?.digest).toBe('failed-register')
  m.run.mockClear(); m.prepare.mockClear()
  await act(async () => { await current.retryFailed() })
  expect(m.prepare).not.toHaveBeenCalled(); expect(m.saved).toBe(original)
  expect(m.run.mock.calls.map(([step]) => step.kind)).toEqual(['REGISTER', 'MINT'])
  expect(m.run.mock.calls[0][1]).toEqual({ startNew: true, expectedPacket: { digest: 'failed-register', bytes: 'register-bytes' } })
  expect(m.run.mock.calls[1][1]).toEqual({ startNew: true })
  expect(current.status).toBe('done')
})
it('wallet change waits for the old operation to settle then loads the new wallet recovery', async () => {
  let settle!: (value: null) => void
  m.read.mockImplementationOnce(() => new Promise(resolve => { settle = resolve }))
  let pending!: Promise<void>
  await act(async () => { pending = current.publish(draft()) })
  m.account = { address: '0x' + '22'.repeat(32) }
  await act(async () => { root.render(<Harness />) })
  expect(current.loadingRecovery).toBe(true)
  await act(async () => { settle(null); await pending })
  expect(current.loadingRecovery).toBe(false)
  expect(m.prepare).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled()
  expect(m.read.mock.calls.at(-1)![0]).toContain(m.account.address)
})
it('a second creation is refused until explicit completed archival, then gets a new content identity', async () => {
  await act(async () => { await current.publish(draft()) })
  const original = m.saved.manifest.request.mints[0].contentObjectId
  await act(async () => { await current.publish(draft()) })
  expect(current.error).toContain('saved creation already exists'); expect(m.prepare).toHaveBeenCalledOnce()
  let archived = false
  await act(async () => { archived = await current.startAnother('MINT', 'completion-key') })
  expect(archived).toBe(true); expect(m.archive.mock.calls[0][0].expectedDigest).toBe('MINT')
  await act(async () => { await current.publish(draft()) })
  expect(current.status).toBe('done'); expect(m.saved.manifest.request.mints[0].contentObjectId).not.toBe(original)
})
it('failed archival keeps the paid operation and does not permit a fresh creation', async () => {
  await act(async () => { await current.publish(draft()) })
  const saved = m.saved; m.archive.mockRejectedValue(Error('disk full'))
  let archived = true
  await act(async () => { archived = await current.startAnother('MINT', 'completion-key') })
  expect(archived).toBe(false); expect(current.error).toBe('disk full'); expect(m.saved).toBe(saved)
})
it('a wallet change during the final post-archive refresh cannot authorize resetting the new wallet draft', async () => {
  await act(async () => { await current.publish(draft()) })
  let settle!: (value: null) => void
  m.archive.mockImplementationOnce(async () => {
    m.saved = null; m.head = null
    m.read.mockImplementationOnce(() => new Promise(resolve => { settle = resolve }))
  })
  let pending!: Promise<boolean>
  await act(async () => { pending = current.startAnother('MINT', 'completion-key') })
  m.account = { address: '0x' + '22'.repeat(32) }
  await act(async () => { root.render(<Harness />) })
  let result = true
  await act(async () => { settle(null); result = await pending })
  expect(result).toBe(false)
})
