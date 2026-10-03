// Test-bundle transports/providers only. Production pages and usePublish remain real.
import React, { useSyncExternalStore } from 'react'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { SOUL_PUBLIC_USDC_TYPE } from '@soulidity/sdk'
import { importSoulAuthoringRecovery, exportSoulAuthoringRecovery, readSoulAuthoringRecovery } from '../../../web/lib/soulidity/soul-authoring-recovery'
import { browserSoulAuthoringStore as realAuthoringStore, soulAuthoringStoreKey } from '../../../web/lib/soulidity/soul-authoring-store'
import { MAINNET_GENESIS_DIGEST } from '../../../web/lib/animacraft/mainnet-chain'
import { ClientCache } from '@mysten/sui/client'
import { proveSoulAuthoringRecovery } from '../../../web/lib/soulidity/soul-authoring-restore'
const id = (n: number) => '0x' + n.toString(16).padStart(64, '0')
const account = { address: id(11) }, wallet = {}, client = { cache: new ClientCache(), ledgerService: {
  getServiceInfo: async () => ({ response: { chainId: MAINNET_GENESIS_DIGEST } }),
} }
const listeners = new Set<() => void>()
let revision = 0
function emit() { revision++; listeners.forEach(fn => fn()) }
export function useFixture() { useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => revision); return fixture }
let recoveryTarget: any = null
let recoverySnapshot: ReturnType<typeof importSoulAuthoringRecovery> | null = null
export async function initializeRecoveryFixture() {
  if (!new URLSearchParams(location.search).has('recovery-export') && !new URLSearchParams(location.search).has('recovery-import')) return
  const response = await fetch('/recovery-fixture.json')
  if (!response.ok) throw Error('Generated recovery fixture missing')
  recoverySnapshot = importSoulAuthoringRecovery(await response.text())
  account.address = recoverySnapshot.manifest.request.author
  recoveryTarget = recoverySnapshot.manifest.request.target
  if (new URLSearchParams(location.search).has('paid-recovery')) {
    const rpcResponse = await fetch('/recovery-rpc.json')
    if (!rpcResponse.ok) throw Error('Controlled historical RPC transcript missing')
    const entries: Array<[string, unknown]> = await rpcResponse.json(), transcript = new Map(entries)
    const encode = (value: unknown) => JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? { $bigint: String(v) }
      : v instanceof Uint8Array ? { $bytes: toBase64(v) } : v)
    const decode = (value: unknown) => JSON.parse(JSON.stringify(value), (_key, v) => v && typeof v === 'object'
      && Object.keys(v).length === 1 ? typeof v.$bigint === 'string' ? BigInt(v.$bigint)
        : typeof v.$bytes === 'string' ? fromBase64(v.$bytes) : v : v)
    let holdNextProof = new URLSearchParams(location.search).has('interrupt-recovery')
    for (const method of new Set(entries.map(([key]) => key.slice(0, key.indexOf(':'))))) {
      (client.ledgerService as any)[method] = async (request: unknown, options?: { abort?: AbortSignal }) => {
        if (method === 'getTransaction' && holdNextProof) {
          holdNextProof = false
          log('test-only proof response held; leave original page to interrupt before any restore write')
          await new Promise<void>((_resolve, reject) => {
            const abort = () => { log('held proof aborted; no response accepted'); reject(options?.abort?.reason ?? new Error('Aborted')) }
            if (options?.abort?.aborted) abort()
            else options?.abort?.addEventListener('abort', abort, { once: true })
          })
        }
        const key = `${method}:${encode(request)}`
        if (!transcript.has(key)) throw Error(`Controlled historical response unavailable: ${method}`)
        const value = decode(transcript.get(key))
        if (value?.$error) throw Object.assign(new Error(value.$error.message), { code: value.$error.code })
        return value
      }
    }
  }
  if (new URLSearchParams(location.search).has('recovery-import')) {
    fixture.route = recoverySnapshot.manifest.request.collection ? '/collections/create' : '/create'
    log('clean-device import fixture: wallet/chain identity controlled; real IndexedDB, no seeded creation')
    return
  }
  const p = { schema: 'soulidity.soul-authoring-preparation.v1' as const,
    manifest: recoverySnapshot.manifest, preparation: recoverySnapshot.upload.preparation }
  // Seed only an unpaid test preparation using the real atomic store; never overwrite.
  if (recoverySnapshot.head || recoverySnapshot.history.length || recoverySnapshot.upload.registration) throw Error('Fixture must be pre-payment')
  await realAuthoringStore().create(soulAuthoringStoreKey(p.manifest.request), p)
  log('test-only encrypted preparation persisted in real IndexedDB; no wallet request')
}
export async function verifyDownloadedRecovery(file: File) {
  if (!recoverySnapshot) throw Error('Recovery fixture not initialized')
  const imported = importSoulAuthoringRecovery(await file.text())
  const p = { schema: 'soulidity.soul-authoring-preparation.v1' as const,
    manifest: recoverySnapshot.manifest, preparation: recoverySnapshot.upload.preparation }
  const retained = await readSoulAuthoringRecovery(p)
  const expected = new URLSearchParams(location.search).has('paid-recovery')
    ? await proveSoulAuthoringRecovery({ bundle: recoverySnapshot, client: client as any, target: recoveryTarget,
      lifetime: { signal: new AbortController().signal, getAddress: () => account.address, isCurrent: () => true } }) : recoverySnapshot
  if (exportSoulAuthoringRecovery(imported) !== exportSoulAuthoringRecovery(recoverySnapshot)
    || exportSoulAuthoringRecovery(retained) !== exportSoulAuthoringRecovery(expected)) throw Error('Downloaded/local recovery mismatch')
  log(`recovery verified: ${file.name}; ${imported.upload.preparation.payloads.length} files; same author/operation and bytes; local records match fresh proof`)
}
const importMode = new URLSearchParams(location.search).get('flow') === 'import'
const wrapMode = new URLSearchParams(location.search).get('flow') === 'wrap'
const collectionMode = new URLSearchParams(location.search).get('flow') === 'collection'
const addSoulMode = new URLSearchParams(location.search).get('flow') === 'add-soul'
const batchMode = collectionMode && new URLSearchParams(location.search).has('batch')
const entryMode = wrapMode && new URLSearchParams(location.search).has('entry')
const sourceNft = { objectId: id(44), objectType: `${id(45)}::nft::NFT`, name: 'Original Wrapped NFT', description: null, imageUrl: null }
let sourceVisible = true
export const fixture = { route: addSoulMode ? `/collections/${id(30)}` : collectionMode ? new URLSearchParams(location.search).has('entry') ? '/collections/create' : '/collections/create/preview' : wrapMode ? entryMode ? '/wrap-link/personal' : '/wrap-link/personal/preview' : importMode ? '/import/gas' : '/create/gas', scenario: 'FAILED', saved: null as any, head: null as any, history: [] as any[],
  events: [] as string[], archiveFails: false, preparations: 0, mintAttempts: 0, registrations: 0 }
function log(s: string) { fixture.events.push(s); emit() }
const navigate = (route: string) => { fixture.route = route; log(`route:${route}`) }
const router = { replace: navigate, push: navigate }
export function useRouter() { return router }
export function usePathname() { return fixture.route }
export function useSearchParams() { return new URLSearchParams(fixture.route.split('?')[1] ?? '') }
const scan = { progress: { coverage: 'COMPLETE', pages: 1, busy: false }, coverage: 'COMPLETE', error: null, refresh: async () => {}, pause: () => {} }
export function useCollectionDetail() { return { identityKey: 'controlled-detail', isLoading: false, error: null, detail: scan, members: scan,
  data: { onChainId: id(30), name: 'Original Add Soul Collection', description: 'Controlled creator-owned Collection', imageUrl: null,
    creatorAddress: account.address, currentHolderAddress: account.address, isCreator: true, isHolder: true,
    currentSoulSupply: '0', maxSoulSupply: '100', atCapacity: false, tradeable: true, listingStatus: 'unlisted',
    floorPriceAtomic: '1250000', extraRoyaltyBps: 500, souls: [], membersComplete: true, memberCount: 0, page: 1, pages: 1,
    stats: { soulFloorAtomic: null, soulVolume: null, soulHolders: 0 } } } }
export function useCollectionBuy() { return { identityKey: 'controlled-buy', records: [], history: [], pending: false, error: null } }
export const ListCollectionModal = () => null
export const EditCollectionPriceModal = () => null
export const DelistCollectionModal = () => null
export default function Link({ href, children, ...props }: any) { return <a {...props} href={'#' + href} onClick={e => { e.preventDefault(); navigate(href) }}>{children}</a> }
export function useCurrentAccount() { return account }
export function useCurrentWallet() { return { currentWallet: wallet, isConnecting: false } }
export function useAutoConnectWallet() { return 'attempted' }
export function useWalletSign() { return { suiWallet: account, suiGrpcClient: client, getWalletAddress: () => account.address,
  signTransaction: async () => { throw Error('No real wallet is permitted in this fixture') } } }
export const useAuth = () => ({ user: null })
export const useLogin = () => () => log('login requested')
const toast = { showToast: (message: string) => log(`toast:${message}`) }
export const useToast = () => toast
export const MIN_SUI_BALANCE = 0.04
export const minimumSuiBalanceForWalletTransactions = (count: number) => MIN_SUI_BALANCE * count
export const formatBalance = String
export const useWalletBalances = () => ({ sui: 1, loading: false, refresh: () => {} })
const cover = new File(['controlled'], 'cover.png', { type: 'image/png' })
const ctx = { name: 'Browser Acceptance Soul', description: 'Isolated fixture; not a real mint',
  floorPrice: '', extraRoyaltyBps: 500, tradeable: true, unlimitedSupply: true, supplyCap: '',
  batchSouls: batchMode ? Array.from({ length: 23 }, (_, i) => ({ name: `Batch Soul ${i + 1}`, description: 'Controlled batch recovery fixture', tags: ['fixture'], creatorRoyaltyBps: 500 })) : [],
  batchFile: batchMode ? new File(['controlled metadata rows'], 'batch.csv') : null,
  batchErrors: [], folderErrors: [], soulFolders: new Map(), addSoulsMethod: batchMode ? 'batch-upload' : 'skip',
  listCollectionRightOnLaunch: false, collectionRightListingPrice: '', successSnapshot: null as any,
  setListCollectionRightOnLaunch: (v: boolean) => { ctx.listCollectionRightOnLaunch = v; emit() },
  setCollectionRightListingPrice: (v: string) => { ctx.collectionRightListingPrice = v; emit() },
  selectedNft: entryMode ? null : sourceNft as typeof sourceNft | null,
  setSelectedNft: (value: typeof sourceNft | null) => { ctx.selectedNft = value; emit() },
  resolvedName: 'Browser Imported Soul', resolvedDescription: 'Imported source fixture', originRef: 'sha256:browser-original-source',
  rawFile: new File(['source'], 'original-source.json'), importResult: null as any,
  coverImageFile: cover, charFile: entryMode ? null : new File(['soul'], 'SOUL.md') as File | null, memoryFile: entryMode ? null : new File(['memory'], 'MEMORY.md') as File | null,
  skillsFile: null as File | null, royalty: 500, tags: 'fixture', listOnPublish: false, listingPriceAtomic: null,
  setCharFile: (f: File | null) => { ctx.charFile = f; emit() }, setMemoryFile: (f: File | null) => { ctx.memoryFile = f; emit() },
  setSkillsFile: (f: File | null) => { ctx.skillsFile = f; emit() }, setRoyalty: (v: number) => { ctx.royalty = v; emit() },
  collectionBindTarget: null, isHydrated: true, publishResult: null as any,
  setPublishResult: (r: any, snapshot?: any) => { ctx.publishResult = r; ctx.successSnapshot = snapshot; emit() },
  setImportResult: (r: any) => { ctx.importResult = r; emit() },
  reset: () => { ctx.publishResult = null; ctx.importResult = null; log('form reset after retained completion') } }
export const useCreateSoul = () => ctx
export const useCreateCollection = () => ctx
export const collectionSteps = [{ label: 'Info' }, { label: 'Add Souls' }, { label: 'Preview' }, { label: 'Launched' }]
export const useImportSoul = () => ctx
export const useWrap = () => ctx
export const useKioskNfts = () => ({ data: sourceVisible ? [sourceNft] : [], isLoading: false })
export const wrapSteps = [{ label: 'Select NFT' }, { label: 'Soul Layers' }, { label: 'Preview & Sign' }, { label: 'Done' }]
export const getCollectionBuyTarget = () => recoveryTarget ?? ({ chainIdentifier: '35834a8a', originalPackageId: id(1), callablePackageId: id(1),
  callableDigest: '1'.repeat(32), marketConfigId: id(2), kioskRegistryId: id(3), personalKioskTypePackageId: id(4),
  paymentCoinType: SOUL_PUBLIC_USDC_TYPE, collectionTransferPolicyId: id(6), kioskPackageId: id(7) })
export const createWalrusClient = async () => ({})
export const WALRUS_BATCH_STORE_CHANGED = 'fixture-authoring-changed'
export const browserWalrusBatchStore = () => ({})
export const getBrowserContentSealConfig = () => ({})
export const collectionDraftStore = { read: async () => { throw Error('Controlled unreadable editing draft') },
  write: async () => { throw Error('Unreadable editing draft must not be overwritten') } }
export const browserSoulAuthoringStore = () => ({ read: async () => {
  if (!fixture.saved && new URLSearchParams(location.search).has('cold-launch')) {
    fixture.saved = { manifest: { request: { collection: { name: 'Saved Registered Collection', description: 'Recovered independently of editing draft',
      floorPriceAtomic: '1250000', extraRoyaltyBps: 500, tradeable: true, maxSupply: '10000', listingPriceAtomic: null }, mints: [] } },
      preparation: { manifest: { files: [{ file: cover, uploadType: 'public' }] } } }
    const tx = new Transaction(); tx.setSender(account.address); tx.setGasOwner(account.address)
    tx.setGasBudget(1000000); tx.setGasPrice(1); tx.setExpiration({ Epoch: '99' })
    tx.setGasPayment([{ objectId: id(77), version: '1', digest: '1'.repeat(32) }])
    const bytes = TransactionDataBuilder.restore(tx.getData()).build()
    fixture.head = { plan: { step: { kind: 'REGISTER', kiosk: { kind: 'NEW', kioskId: null, capId: null } } },
      packet: { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), phase: 'SUCCEEDED', expirationEpoch: '99' }, observed: 'SUCCEEDED' }
    log('fixture loaded prior registered Collection; no new preparation or registration')
  }
  return fixture.saved
} })
export const prepareSoulAuthoring = async ({ request, files }: any) => {
  fixture.preparations++; fixture.saved = { manifest: { request }, preparation: { manifest: { files } } }; log(`prepared:${request.mints[0]?.contentObjectId ?? 'empty collection'}; bind:${request.bindCollectionId ?? 'none'}`); return fixture.saved
}
export const browserSoulAuthoringPacketJournal = () => ({ read: async () => fixture.head, history: async () => [...fixture.history] })
export const resolveSoulAuthoringKiosk = async () => ({ kind: 'NEW', kioskId: null, capId: null })
export const soulAuthoringCompletionKey = () => 'controlled-completion'
export const readSoulAuthoringCompletion = async () => null
export const archiveCompletedSoulAuthoring = async () => {
  if (fixture.archiveFails) throw Error('Controlled archive failure; original creation retained.')
  fixture.saved = null; fixture.head = null; fixture.history = []; log('completion retained; active lane released'); return 'controlled-completion'
}
function outcome(record: any) {
  const step = record.plan.step, request = fixture.saved.manifest.request
  const indices = step.kind === 'MINT' ? step.chunk?.mintIndices ?? [0] : []
  return { status: record.packet.phase === 'RETIRED' ? 'MISSING' : record.observed, record,
    receipt: { business: { stage: step.kind, transactionDigest: record.packet.digest,
      collection: step.kind === 'REGISTER' && request.collection ? { collectionId: id(30), rightId: id(31), listingId: null } : null,
      mints: indices.map((i: number) => ({ mintIndex: i, soulId: id(100+i), stateId: id(200+i), contentId: request.mints[i].contentObjectId, listingId: null })) },
      consumption: { indices: fixture.saved.preparation.manifest.files.flatMap((file: any, i: number) =>
        step.kind === 'MINT' && (file.uploadType === 'public' ? step.chunk?.includePublicFiles !== false
          : indices.some((j: number) => request.mints[j].slots.some((s: any) => s.fileIndex === i))) ? [i] : []) } } }
}
export const createSoulAuthoringWallet = ({ approve }: any) => ({
  query: async (record: any) => outcome(record ?? fixture.head),
  accept: async () => {},
  run: async (step: any, options: any = {}) => {
    if (fixture.head?.observed === 'SUCCEEDED' && !options.startNew && fixture.head.plan.step.kind === step.kind) return outcome(fixture.head)
    if (options.retireExpired) {
      if (fixture.scenario !== 'EXPIRED') throw Error('Controlled transaction is not expired.')
      fixture.head.packet.phase = 'RETIRED'; fixture.head.observed = 'MISSING'; log('retired selected packet; no signature requested')
    } else if (!options.queryOnly) {
      const retained = fixture.head && fixture.head.plan.step.kind === step.kind && !options.startNew ? fixture.head : null
      const tx = new Transaction(); tx.setSender(account.address); tx.setGasOwner(account.address)
      tx.setGasBudget(1000000); tx.setGasPrice(1); tx.setExpiration({ Epoch: '99' })
      tx.setGasPayment([{ objectId: id(77), version: String(fixture.events.length + 1), digest: '1'.repeat(32) }])
      const bytes = TransactionDataBuilder.restore(tx.getData()).build()
      if (!retained && fixture.head) fixture.history.push(fixture.head)
      fixture.head = retained ?? { plan: { step }, packet: { bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes),
        expirationEpoch: '99', phase: 'SIGNING', signature: null }, observed: 'MISSING' }
      if (!await approve(fixture.head)) { log('fee declined; wallet requests:0'); throw Error('USER_DECLINED_PACKET') }
      log(`controlled approval:${step.kind}`)
      if (step.kind === 'REGISTER') { fixture.registrations++; fixture.head.observed = 'SUCCEEDED' }
      else { fixture.mintAttempts++; fixture.head.observed = batchMode && fixture.mintAttempts === 1 ? 'SUCCEEDED' : fixture.scenario === 'EXPIRED' ? 'MISSING' : fixture.scenario }
      if (step.kind === 'MINT') log(`mint indices:${JSON.stringify(step.chunk?.mintIndices ?? [0])}; outcome:${fixture.head.observed}`)
      fixture.head.packet.phase = fixture.head.observed === 'MISSING' ? 'SIGNED' : fixture.head.observed
    } else log(`queried:${fixture.head.observed}`)
    return outcome(fixture.head)
  },
})
export function setScenario(s: string) { fixture.scenario = s; log(`fixture outcome:${s}`) }
export function setArchiveFailure(value: boolean) { fixture.archiveFails = value; emit() }
export function toGas() { navigate(collectionMode ? '/collections/create/preview' : wrapMode ? '/wrap-link/personal/preview' : importMode ? '/import/gas' : '/create/gas') }
export function coldWrapEntry() {
  if (collectionMode) { navigate('/collections/create'); return }
  ctx.selectedNft = null; ctx.charFile = null; ctx.memoryFile = null; sourceVisible = false; navigate('/wrap-link/personal')
}
