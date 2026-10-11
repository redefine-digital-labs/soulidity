'use client'

import { useEffect, useRef } from 'react'
import { useCommittedSession, useSessionState } from './use-committed-session'
import { useCurrentAccount, useCurrentWallet } from '@mysten/dapp-kit'
import { fromHex, normalizeSuiAddress, toHex } from '@mysten/sui/utils'
import { deriveMintContentObjectId, extractSkillBundleMetadata, hasZipSignature, normalizeTags,
  KIND_SOUL_DOC, KIND_MEMORY, KIND_SKILL, preflightCollectionBindTarget, getRequiredSoulidityEnv } from '@soulidity/sdk'
import { useWalletSign } from './use-wallet-sign'
import { getCollectionBuyTarget } from './use-collection-buy'
import { createWalrusClient, type BatchSoulUploadFile } from '../upload/client-upload'
import { browserWalrusBatchStore, WALRUS_BATCH_STORE_CHANGED } from '../upload/walrus-batch-store'
import { getBrowserContentSealConfig } from '../soulidity/browser-content-open'
import { parseSoulAuthoringRequest, parseSoulAuthoringTarget } from '../soulidity/soul-authoring-manifest'
import { browserSoulAuthoringStore, type SoulAuthoringPreparation } from '../soulidity/soul-authoring-store'
import { prepareSoulAuthoring } from '../soulidity/soul-authoring-preparation'
import { browserSoulAuthoringPacketJournal } from '../soulidity/soul-authoring-journal'
import { createSoulAuthoringWallet } from '../soulidity/soul-authoring-wallet'
import { resolveSoulAuthoringKiosk } from '../soulidity/soul-authoring-kiosk'
import type { SoulAuthoringPacketRecord } from '../soulidity/soul-authoring-packet'
import type { SoulAuthoringBusinessReceipt } from '../soulidity/soul-authoring-history'
import { archiveCompletedSoulAuthoring, readSoulAuthoringCompletion, soulAuthoringCompletionKey } from '../soulidity/soul-authoring-completion'
import { buildCollectionAuthoringInput, type CollectionAuthoringInput } from '../soulidity/collection-authoring-input'
import { advanceCollectionAuthoring, type CollectionAuthoringResult } from '../soulidity/collection-authoring-flow'
import { exportSoulAuthoringRecovery, readSoulAuthoringRecovery } from '../soulidity/soul-authoring-recovery'
import type { SoulAuthoringRecovery } from '../soulidity/soul-authoring-recovery'
import { restoreSoulAuthoringRecovery } from '../soulidity/soul-authoring-restore'

export type PublishStatus = 'idle' | 'building' | 'signing' | 'syncing' | 'done' | 'error'
export interface PublishSyncResponse {
  txDigest: string; soulOnChainId: string; stateOnChainId: string; memoryOnChainId: string
  listingStatus: string; collectionOnChainId?: string | null; collectionAddTxDigest?: string | null
  listingTxDigest?: string | null; listingObjectOnChainId?: string | null; listedPriceAtomic?: string | null
  authoringCompletionKey?: string
  provenanceKind?: 'ordinary' | 'imported' | 'personal-join'
  originRef?: string
}
export interface PublishParams {
  name: string; description: string; tags: string[]; creatorRoyaltyBps: number
  cover: File; character: File; memory: File; skills: File | null
  collectionBindTarget: { collectionOnChainId: string } | null
  listOnPublish: boolean; listingPriceAtomic: string | null
  originRef?: string
}
export type JoinedPublishParams = Omit<PublishParams, 'cover'> & {
  imageUrl: string; source: { objectId: string; objectType: string }
}
export function getSoulAuthoringTarget() {
  return parseSoulAuthoringTarget({ ...getCollectionBuyTarget(),
    kindRegistryId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID'),
    soulTransferPolicyId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID'),
    blobBaseUrl: (process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL || 'https://aggregator.mainnet.walrus.mirai.cloud').replace(/\/$/, ''),
  })
}
const nonce = () => toHex(crypto.getRandomValues(new Uint8Array(16)))
function key(author: string) {
  const target = getSoulAuthoringTarget()
  return `soul-authoring:${target.chainIdentifier}:${target.originalPackageId}:${author}`
}
const empty = { status: 'idle' as PublishStatus, exportingRecovery: false, error: null as string | null, txDigest: null as string | null,
  collectionData: null as CollectionAuthoringResult | null, progress: { totalSouls: 0, mintedSouls: 0, boundSouls: 0 },
  selectedPacket: null as { bytes: string; digest: string } | null,
  publishData: null as PublishSyncResponse | null, recovery: null as SoulAuthoringPreparation | null, loadingRecovery: true,
  retryPacket: null as { bytes: string; digest: string; retired?: boolean } | null }

/** Original ordinary-create controller. No auth API, post-mint mirror or private
 * sidecar upload: identity and encrypted bytes are saved before any payment. */
export function usePublish(approve: (record: SoulAuthoringPacketRecord, signal: AbortSignal) => Promise<boolean>) {
  return useSingleSoulAuthoring(approve, 'ORDINARY')
}
export function useSingleSoulAuthoring(approve: (record: SoulAuthoringPacketRecord, signal: AbortSignal) => Promise<boolean>, kind: 'ORDINARY' | 'IMPORTED' | 'JOINED' | 'COLLECTION') {
  const wallet = useWalletSign(), account = useCurrentAccount(), { currentWallet } = useCurrentWallet()
  const { suiWallet, suiGrpcClient: client } = wallet
  const session = useCommittedSession(kind, account, client, currentWallet)
  const generation = session.generation, active = useRef<AbortController | null>(null)
  const refreshCurrent = useRef<() => Promise<void>>(async () => {})
  const [state, setState] = useSessionState(session, { ...empty, generation, loadingRecovery: Boolean(account) })
  const matches = () => session.matches()
  const update = (patch: Partial<typeof empty>) => {
    if (matches()) setState(old => ({ ...(old.generation === generation ? old : empty), ...patch, generation }))
  }
  useEffect(() => {
    const lease = session.capture()
    if (!lease?.matches()) return
    const matches = () => lease.matches()
    const refresh = async () => {
      if (active.current || !account) return
      await Promise.resolve().then(async () => {
        const recovery = await browserSoulAuthoringStore().read(key(normalizeSuiAddress(account.address)))
        if (!matches() || active.current) return
        const head = recovery ? await browserSoulAuthoringPacketJournal(recovery).read(`${key(normalizeSuiAddress(account.address))}:packets`) : null
        return { recovery, head }
      }).then(result => {
        if (!result) return
        const { recovery, head } = result
        if (!active.current && matches()) setState(old => {
          // Same-wallet storage can move to another creation after archival on
          // another page. Never apply the prior operation's progress/results.
          const sameCreation = old.generation === generation
            && old.recovery?.manifest.request.operationId === recovery?.manifest.request.operationId
            && old.recovery?.manifest.preparationHash === recovery?.manifest.preparationHash
          return { ...(sameCreation ? old : empty),
          recovery, txDigest: head?.packet.digest ?? null, loadingRecovery: false, generation,
          selectedPacket: head ? { bytes: head.packet.bytes, digest: head.packet.digest } : null,
          retryPacket: sameCreation && old.retryPacket
            && old.retryPacket.bytes === head?.packet.bytes && old.retryPacket.digest === head?.packet.digest
            ? old.retryPacket : null }
        })
      }).catch(cause => { if (matches()) update({ status: 'error', error: cause instanceof Error ? cause.message : 'Cannot read saved creation.', loadingRecovery: false }) })
    }
    refreshCurrent.current = refresh
    void refresh()
    const changed = () => { void refresh() }
    window.addEventListener(WALRUS_BATCH_STORE_CHANGED, changed)
    return () => { active.current?.abort()
      window.removeEventListener(WALRUS_BATCH_STORE_CHANGED, changed) }
  }, [session])

  async function publish(input?: PublishParams | JoinedPublishParams | CollectionAuthoringInput, queryOnly = false, retryPacket?: { bytes: string; digest: string; retired?: boolean }, retirePacket?: { bytes: string; digest: string }) {
    const lease = session.capture()
    if (!lease?.matches() || active.current) return
    const matches = () => lease.matches()
    const update = (patch: Partial<typeof empty>) => { if (matches()) setState(old => ({ ...old, ...patch, generation })) }
    if (!account || !client) throw new Error('Connect the creating wallet first.')
    const author = normalizeSuiAddress(account.address), controller = new AbortController()
    active.current = controller
    lease.requests.add(controller)
    const signal = controller.signal
    const guard = () => { signal.throwIfAborted(); if (!matches()) throw new Error('Wallet changed; resume with the original wallet.') }
    const lifetime = { signal, getAddress: wallet.getWalletAddress, isCurrent: matches }
    update({ status: queryOnly ? 'syncing' : 'building', error: null, retryPacket: null })
    try {
      const target = getSoulAuthoringTarget()
      const bindDeployment = { originalPackageId: target.originalPackageId, chainIdentifier: target.chainIdentifier,
        marketConfigId: target.marketConfigId, paymentCoinType: target.paymentCoinType,
        kioskRegistryId: target.kioskRegistryId, personalKioskTypePackageId: target.personalKioskTypePackageId }
      const store = browserSoulAuthoringStore()
      let preparation = await store.read(key(author)); guard()
      if (!preparation && !input) throw new Error('No saved creation was found.')
      if (preparation && input) throw new Error('A saved creation already exists. Resume it before starting another Soul.')
      const walrus = await createWalrusClient({ suiClient: client, network: 'mainnet' }); guard()
      if (!preparation && kind === 'COLLECTION') {
        const built = await buildCollectionAuthoringInput(input as CollectionAuthoringInput, target, author, signal); guard()
        preparation = await prepareSoulAuthoring({ ...built, client: walrus, lifetime, store,
          wallet: { client, sealClient: client, signal, getAddress: wallet.getWalletAddress, signPersonalMessage: wallet.signPersonalMessage },
          sealConfig: getBrowserContentSealConfig(), recoveryNonce: nonce() }); guard()
      }
      if (!preparation) {
        const draft = input as PublishParams | JoinedPublishParams
        const joined = 'source' in draft ? draft : null
        if ((kind === 'JOINED') !== Boolean(joined)) throw new Error('The selected creation entry does not match its source.')
        let skillName = 'default'
        if (draft.skills) {
          const bytes = new Uint8Array(await draft.skills.arrayBuffer()); guard()
          if (hasZipSignature(bytes)) skillName = extractSkillBundleMetadata(bytes).skillName || 'default'
        }
        const mintNonce = nonce()
        const files: BatchSoulUploadFile[] = [
          ...('cover' in draft ? [{ file: draft.cover, uploadType: 'public' as const, kind: 'persona-sprite' as const, sendObjectTo: author }] : []),
          { file: draft.character, uploadType: 'encrypted', kind: 'soul-content', sendObjectTo: author },
          { file: draft.memory, uploadType: 'encrypted', kind: 'soul-content', sendObjectTo: author },
          ...(draft.skills ? [{ file: draft.skills, uploadType: 'encrypted' as const, kind: 'soul-content' as const,
            sendObjectTo: author, extractSkillMetadata: true }] : []),
        ]
        const offset = joined ? 0 : 1
        const slot = (fileIndex: number, kind: number, name: string) => ({ fileIndex, kind, name,
          versionIndex: '0', readModeMask: 3, downloadPolicy: 'public', setActive: false })
        const request = parseSoulAuthoringRequest({
          schema: 'soulidity.soul-authoring-request.v1', target, author, operationId: nonce(), storageEpochs: 26,
          collection: null, bindCollectionId: draft.collectionBindTarget?.collectionOnChainId ?? null,
          mints: [{ kind, mintNonce, contentObjectId: deriveMintContentObjectId({
            originalPackageId: target.originalPackageId, kioskRegistryId: target.kioskRegistryId, author, mintNonce: fromHex(mintNonce) }),
            name: draft.name, description: draft.description, creatorRoyaltyBps: draft.creatorRoyaltyBps,
            image: joined ? { kind: 'URL', url: joined.imageUrl } : { kind: 'FILE', fileIndex: 0 },
            originRef: kind !== 'ORDINARY' ? draft.originRef ?? null : null, source: joined?.source ?? null,
            slots: [slot(offset, KIND_SOUL_DOC, 'soul'), slot(offset + 1, KIND_MEMORY, 'default'),
              ...(draft.skills ? [slot(offset + 2, KIND_SKILL, skillName)] : [])],
            publicPreview: joined ? { tags: [], previewImages: [] } : { tags: normalizeTags(draft.tags), previewImages: [{ kind: 'FILE', fileIndex: 0 }] },
            stateConfig: [], listingPriceAtomic: draft.listOnPublish ? draft.listingPriceAtomic : null }],
        })
        if (draft.listOnPublish && !request.mints[0].listingPriceAtomic) throw new Error('Set a listing price before publishing.')
        if (request.bindCollectionId) await preflightCollectionBindTarget({ client, deployment: bindDeployment,
          walletAddress: author, collectionId: request.bindCollectionId, signal })
        guard()
        preparation = await prepareSoulAuthoring({ request, files, client: walrus, lifetime, store,
          wallet: { client, sealClient: client, signal, getAddress: wallet.getWalletAddress, signPersonalMessage: wallet.signPersonalMessage },
          sealConfig: getBrowserContentSealConfig(), recoveryNonce: nonce() })
        guard()
      }
      const p = preparation, request = p.manifest.request
      if (kind === 'COLLECTION' ? !request.collection : request.collection || request.mints.length !== 1 || request.mints[0].kind !== kind)
        throw new Error('This saved operation belongs to another authoring flow. Open its original page.')
      update({ recovery: p })
      const journal = browserSoulAuthoringPacketJournal(p), headKey = `${key(author)}:packets`
      let head = await journal.read(headKey); guard()
      const execution = createSoulAuthoringWallet({ client, walrus, preparation: p, lifetime, getTarget: getSoulAuthoringTarget,
        authoring: store, uploads: browserWalrusBatchStore(), journal,
        sign: async transaction => { guard(); update({ status: 'signing' }); return wallet.signTransaction(transaction) },
        approve: async record => { guard(); update({ txDigest: record.packet.digest, status: 'signing' }); return approve(record, signal) },
      })
      if (retryPacket) {
        if (!head || head.packet.bytes !== retryPacket.bytes || head.packet.digest !== retryPacket.digest)
          throw new Error('The selected transaction changed. Check the current transaction before retrying.')
        const observed = await execution.query(head); guard()
        if (retryPacket.retired ? head.packet.phase !== 'RETIRED' || observed.status !== 'MISSING' : observed.status !== 'FAILED')
          throw new Error('A finalized failure is required to create a replacement transaction, or a re-proved retired packet. Check the original transaction.')
      }
      const unfinished = (result: Awaited<ReturnType<typeof execution.run>>) => {
        const failed = result.status === 'FAILED'
        const retired = result.status === 'MISSING' && result.record.packet.phase === 'RETIRED'
        update({ status: 'idle', txDigest: result.record.packet.digest,
          retryPacket: failed || retired ? { bytes: result.record.packet.bytes, digest: result.record.packet.digest, ...(retired ? { retired: true } : {}) } : null,
          error: retired ? 'The expired transaction is safely retired and its evidence is retained. Retry uses the same creation and confirmed storage, with a new fee review.'
            : failed ? 'The transaction failed on chain. Retry will create a new transaction and may incur gas fees. Confirmed storage is reused.'
            : 'No final success or failure is confirmed. Check or resume the original transaction; no replacement payment is allowed.' })
      }
      const completed = (receipt: SoulAuthoringBusinessReceipt) => {
        const mint = receipt.mints[0]
        if (receipt.stage !== 'MINT' || !mint || mint.mintIndex !== 0) throw new Error('The saved receipt is not the requested Soul.')
        const digest = receipt.transactionDigest, collection = request.bindCollectionId
        update({ status: 'done', txDigest: digest, publishData: {
          txDigest: digest, soulOnChainId: mint.soulId, stateOnChainId: mint.stateId, memoryOnChainId: mint.contentId,
          listingStatus: mint.listingId ? 'listed' : 'unlisted', collectionOnChainId: collection,
          collectionAddTxDigest: collection ? digest : null, listingTxDigest: mint.listingId ? digest : null,
          listingObjectOnChainId: mint.listingId, listedPriceAtomic: request.mints[0].listingPriceAtomic,
          authoringCompletionKey: soulAuthoringCompletionKey(p),
          provenanceKind: kind === 'JOINED' ? 'personal-join' : kind === 'IMPORTED' ? 'imported' : 'ordinary', originRef: request.mints[0].originRef ?? undefined,
        } })
      }
      if (retirePacket) {
        if (!head || head.packet.bytes !== retirePacket.bytes || head.packet.digest !== retirePacket.digest)
          throw new Error('The selected transaction changed. Check the current transaction before retiring it.')
        const result = await execution.run(head.plan.step, { retireExpired: true,
          expectedPacket: retirePacket }); guard()
        unfinished(result); return
      }
      if (kind === 'COLLECTION') {
        const outcome = await advanceCollectionAuthoring({ preparation: p, journal, key: headKey, execution,
          signal, queryOnly, retryPacket, resolveKiosk: () => resolveSoulAuthoringKiosk({ client, target, author, signal }),
          progress: (completed, total) => { guard(); update({ status: queryOnly ? 'syncing' : 'building',
            progress: { totalSouls: total, mintedSouls: completed, boundSouls: completed } }) } })
        guard()
        if (outcome.result) update({ status: 'done', txDigest: outcome.result.txDigest,
          collectionData: { ...outcome.result, authoringCompletionKey: soulAuthoringCompletionKey(p) } })
        else if (outcome.pending) unfinished(outcome.pending)
        else update({ status: 'idle', error: 'Saved Collection checked. Resume to finish the remaining certification and Souls.' })
        return
      }
      if (queryOnly) {
        if (!head) { update({ status: 'idle', error: 'Preparation saved; no transaction has been requested. Resume when ready.' }); return }
        update({ txDigest: head.packet.digest })
        const result = await execution.run(head.plan.step, { queryOnly: true }); guard()
        if (result.status === 'SUCCEEDED' && head.plan.step.kind === 'MINT') completed(result.receipt.business)
        else if (result.status === 'SUCCEEDED') update({ status: 'idle', error: 'Storage payment confirmed. Resume the same creation.' })
        else unfinished(result)
        return
      }
      if (!head || head.plan.step.kind === 'REGISTER') {
        if (request.bindCollectionId) await preflightCollectionBindTarget({ client, deployment: bindDeployment,
          walletAddress: author, collectionId: request.bindCollectionId, signal })
        guard()
        const kiosk = !retryPacket && head?.plan.step.kind === 'REGISTER' ? head.plan.step.kiosk
          : await resolveSoulAuthoringKiosk({ client, target, author, signal })
        const result = await execution.run({ kind: 'REGISTER', kiosk }, retryPacket ? { startNew: true, expectedPacket: retryPacket } : {}); guard()
        update({ txDigest: result.record.packet.digest })
        if (result.status !== 'SUCCEEDED') { unfinished(result); return }
        head = result.record
      }
      const retryMint = Boolean(retryPacket && head.plan.step.kind === 'MINT')
      const step = head.plan.step.kind === 'MINT' && !retryMint ? head.plan.step : { kind: 'MINT' as const, chunk: {
        mintIndices: [0], includePublicFiles: true, collectionObjectId: request.bindCollectionId,
        kiosk: await resolveSoulAuthoringKiosk({ client, target, author, signal }) } }
      update({ status: 'building' })
      const result = await execution.run(step, retryMint ? { startNew: true, expectedPacket: retryPacket }
        : { startNew: head.plan.step.kind === 'REGISTER' }); guard()
      update({ txDigest: result.record.packet.digest })
      if (result.status === 'SUCCEEDED') completed(result.receipt.business)
      else unfinished(result)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Creation interrupted. Saved recovery is retained.'
      const declined = message.includes('USER_DECLINED_PACKET')
      update({ status: declined ? 'idle' : 'error', error: declined
        ? 'Transaction review cancelled. Your saved creation is kept. Resume when ready.'
        : message.includes('EXPIRED_OR_FUTURE_PACKET_QUERY_ONLY')
        ? 'This transaction is outside its signing window. Check its receipt, then use Check Expiry & Retire. Replacement requires confirmed expiry and a fresh missing-transaction result.' : message })
    } finally {
      controller.abort()
      lease.requests.delete(controller)
      if (active.current === controller) active.current = null
      // A wallet change may have mounted a new generation while the old wallet
      // promise was settling. Refresh that generation without releasing early.
      await refreshCurrent.current()
    }
  }
  async function startAnother(expectedDigest: string, completionKey?: string) {
    const lease = session.capture()
    if (!lease?.matches() || active.current || !account || !client) return false
    const matches = () => lease.matches()
    const update = (patch: Partial<typeof empty>) => { if (matches()) setState(old => ({ ...old, ...patch, generation })) }
    const controller = new AbortController(); active.current = controller
    lease.requests.add(controller)
    let completed = false
    update({ status: 'building', error: null })
    try {
      const store = browserSoulAuthoringStore(), author = normalizeSuiAddress(account.address)
      let p = await store.read(key(author))
      if (!p && completionKey) {
        const archived = await readSoulAuthoringCompletion(completionKey)
        if (archived) p = { schema: 'soulidity.soul-authoring-preparation.v1', manifest: archived.manifest, preparation: archived.upload.preparation }
      }
      if (!p || p.manifest.request.author !== author || completionKey && soulAuthoringCompletionKey(p) !== completionKey)
        throw new Error('The selected creation has changed. Open its saved recovery; no draft was reset.')
      if (kind === 'COLLECTION' ? !p.manifest.request.collection
        : p.manifest.request.collection || p.manifest.request.mints.length !== 1 || p.manifest.request.mints[0].kind !== kind)
        throw new Error('This saved operation belongs to another authoring flow. Open its original page.')
      await archiveCompletedSoulAuthoring({ client, preparation: p, expectedDigest,
        lifetime: { signal: controller.signal, getAddress: wallet.getWalletAddress, isCurrent: matches } })
      controller.signal.throwIfAborted()
      if (!matches()) return false
      update({ ...empty, loadingRecovery: false }); completed = true
    } catch (cause) {
      update({ status: 'error', error: cause instanceof Error ? cause.message : 'Could not retain completion proof. Original creation kept.' })
    } finally {
      controller.abort(); lease.requests.delete(controller); if (active.current === controller) active.current = null
      await refreshCurrent.current()
    }
    return completed && matches()
  }
  async function exportRecovery() {
    const lease = session.capture()
    if (!lease?.matches() || active.current || !account || state.generation !== generation || !state.recovery) return null
    const matches = () => lease.matches()
    const update = (patch: Partial<typeof empty>) => { if (matches()) setState(old => ({ ...old, ...patch, generation })) }
    const controller = new AbortController(); active.current = controller
    lease.requests.add(controller)
    update({ exportingRecovery: true, error: null })
    try {
      const p = state.recovery
      const guard = () => {
        controller.signal.throwIfAborted()
        if (!matches() || normalizeSuiAddress(account.address) !== p.manifest.request.author
          || wallet.getWalletAddress() !== p.manifest.request.author) throw new Error('Wallet changed. Recovery export cancelled.')
      }
      guard()
      const snapshot = await readSoulAuthoringRecovery(p); guard()
      const text = exportSoulAuthoringRecovery(snapshot); guard()
      return { text, filename: `soul-creation-${p.manifest.request.operationId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`,
        isCurrent: () => matches() && wallet.getWalletAddress() === p.manifest.request.author }
    } catch (cause) {
      update({ error: cause instanceof Error ? cause.message : 'Cannot export saved creation. Local records are unchanged.' })
      return null
    } finally {
      controller.abort(); lease.requests.delete(controller); if (active.current === controller) active.current = null
      update({ exportingRecovery: false }); void refreshCurrent.current()
    }
  }
  async function importRecovery(bundle: SoulAuthoringRecovery) {
    const lease = session.capture()
    if (!lease?.matches() || active.current || !account || !client) return null
    const matches = () => lease.matches()
    const update = (patch: Partial<typeof empty>) => { if (matches()) setState(old => ({ ...old, ...patch, generation })) }
    const controller = new AbortController(); active.current = controller
    lease.requests.add(controller)
    update({ status: 'syncing', error: null })
    try {
      const href = await restoreSoulAuthoringRecovery({ bundle, client, target: getSoulAuthoringTarget(),
        lifetime: { signal: controller.signal, getAddress: wallet.getWalletAddress, isCurrent: matches } })
      controller.signal.throwIfAborted()
      if (!matches()) return null
      update({ status: 'idle' })
      return { href, isCurrent: matches }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      update({ status: 'error', error: message.includes('LOCAL_CREATION_EXISTS_OPEN_SAVED')
        ? 'This device already has a different or newer saved creation. It was not overwritten. Open the saved creation below.'
        : message.includes('ALREADY_ARCHIVED_OPEN_COMPLETION') ? 'This creation is already archived on this device. It was not restored as a new creation.'
        : message.includes('DEPLOYMENT_MISMATCH') ? 'This recovery belongs to a different deployment. Nothing was restored.'
        : message.includes('LIFETIME_CHANGED') ? 'Connect the original creating wallet and check this recovery again.'
        : message || 'Recovery could not be restored. Keep the file and retry.' })
      return null
    } finally {
      controller.abort(); lease.requests.delete(controller); if (active.current === controller) active.current = null
      void refreshCurrent.current()
    }
  }
  return { ...(state.generation === generation ? state : empty), suiWallet, publish, startAnother, exportRecovery, importRecovery,
    retryFailed: () => state.generation === generation && state.retryPacket ? publish(undefined, false, { ...state.retryPacket }) : Promise.resolve(),
    retireExpired: () => state.generation === generation && state.selectedPacket
      ? publish(undefined, false, undefined, { ...state.selectedPacket }) : Promise.resolve(),
    resume: () => publish(), query: () => publish(undefined, true) }
}
