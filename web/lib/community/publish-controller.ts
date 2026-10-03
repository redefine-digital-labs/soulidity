import { createPublicCommunityPublishIntent, publicCommunityPublishCommitment, validatePublicCommunityUploadReceipt,
  publicCommunityPublishOperationKey, runPublicCommunityPublishOperation, readMyWalletProfile, readPublicCommunityPost,
  type PublicCommunityPublishIntent, type PublicCommunityPublishOperationStore } from '@soulidity/sdk'
import type { BrowserCommunityReadConfig } from './public-post-read'
import { createPublicCommunityPublishOperationClient } from './publish-operation-client'
import { readCommunityPublicationResult } from './publish-receipt'
import { communityPublishUploadScope, type CommunityPublishJournalStore } from './publish-journal'
import type { ProfileSaveTransport } from '../profile/profile-save-controller'

function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`COMMUNITY_PUBLISH_${code}`) }
const json = (value: unknown) => JSON.stringify(value)
type Client = ReturnType<typeof createPublicCommunityPublishOperationClient>
type Dependencies = { profile?: typeof readMyWalletProfile; post?: typeof readPublicCommunityPost
  transaction?: Client; result?: typeof readCommunityPublicationResult }
/** One lease spans the frozen parent, existing paid uploader, and business PTB.
 * Query never starts paid work. Receipts are persisted before cancellation or
 * wallet changes can hide them; unknown operations are never replaced. */
export function createCommunityPublishController(params: Parameters<typeof createPublicCommunityPublishOperationClient>[0] & {
  journals: CommunityPublishJournalStore; operations: PublicCommunityPublishOperationStore; uploads: ProfileSaveTransport
}, dependencies: Dependencies = {}) {
  const config: BrowserCommunityReadConfig = structuredClone(params.config)
  const { client, journals, operations, uploads, writesEnabled, getAddress } = params
  const transaction = dependencies.transaction ?? createPublicCommunityPublishOperationClient({ ...params, config })
  const resultRead = dependencies.result ?? readCommunityPublicationResult
  function writable(intent: PublicCommunityPublishIntent) {
    check(json(intent.deployment) === json(config.deployment), 'RELEASE_CHANGED')
    check(writesEnabled(), 'WRITES_DISABLED'); check(getAddress() === intent.owner, 'RECONNECT_PREPARING_WALLET')
  }
  async function beforeUpload(intent: PublicCommunityPublishIntent) {
    writable(intent)
    const signal = AbortSignal.timeout(30000)
    const profile = await (dependencies.profile ?? readMyWalletProfile)({ client: client.core,
      deployment: config.deployment.profile, owner: intent.owner, signal })
    check(profile?.id === intent.authorId && profile.owner === intent.owner, 'AUTHOR_CHANGED')
    if (intent.kind === 'comment') await (dependencies.post ?? readPublicCommunityPost)({ client,
      deployment: config.deployment, postId: intent.postId, signal })
    writable(intent)
  }
  return {
    inspect: (intent: PublicCommunityPublishIntent) => journals.inspect(intent),
    async run(input: { intent: PublicCommunityPublishIntent; mode: 'start' | 'resume' | 'query' | 'cancel' | 'archive' }) {
      const intent = createPublicCommunityPublishIntent(input.intent), mode = input.mode
      check(['start', 'resume', 'query', 'cancel', 'archive'].includes(mode), 'MODE_INVALID')
      check(json(intent.deployment) === json(config.deployment), 'RELEASE_CHANGED')
      return journals.exclusive(intent, async lease => {
        let journal = await lease.read()
        if (journal) check(mode !== 'start' || json(journal.intent) === json(intent), 'FROZEN_OPERATION_REQUIRED')
        if (!journal) {
          if (mode !== 'start') return { status: 'empty' as const }
          writable(intent)
          journal = { schema: 'soulidity.community-publish-journal.v1', intent, receipt: null }
          await lease.write(journal)
        }
        const frozen = journal.intent, key = publicCommunityPublishOperationKey(frozen)
        return operations.exclusive(key, async () => {
          const leased: PublicCommunityPublishOperationStore = { ...operations, exclusive: async (requested, work) => {
            check(requested === key, 'LEASE_SCOPE_MISMATCH'); return work()
          } }
          const finish = async (record: Awaited<ReturnType<typeof runPublicCommunityPublishOperation>>) => {
            if (record.phase === 'SUCCEEDED') {
              const result = await resultRead({ client, record })
              await lease.archive(journal!)
              return { status: 'published' as const, result }
            }
            return { status: record.phase === 'FAILED' ? 'failed' as const : record.phase === 'CANCELLED' ? 'cancelled' as const : 'pending' as const, record }
          }
          const previous = operations.read(key)
          if (previous) {
            check(json(previous.intent) === json(frozen) && json(previous.receipt) === json(journal!.receipt), 'PARENT_TRANSACTION_MISMATCH')
            const record = await runPublicCommunityPublishOperation({ intent: frozen, store: leased, adapter: transaction.adapter,
              queryOnly: mode === 'query' || mode === 'start' || mode === 'archive', cancelUnsigned: mode === 'cancel' })
            if (mode !== 'archive' || !['FAILED', 'CANCELLED'].includes(record.phase)) return finish(record)
          }
          const scope = communityPublishUploadScope(frozen)
          const recovered = await uploads.recover(scope, frozen.owner)
          if (mode === 'archive' || mode === 'cancel') {
            check(['NONE', 'CERTIFIED', 'FAILED'].includes(recovered.status), 'UPLOAD_UNRESOLVED_CANNOT_ARCHIVE')
            await lease.archive(journal!)
            return { status: 'archived' as const }
          }
          if (mode === 'query') return { status: 'pending' as const }
          await beforeUpload(frozen)
          if (!journal!.receipt) {
            check(recovered.status !== 'FAILED', 'UPLOAD_FAILED_ARCHIVE_REQUIRED')
            // UNKNOWN/SOURCE_REQUIRED resumes the SAME durable upload scope;
            // the existing uploader queries its packets before signing anything.
            const commitment = await publicCommunityPublishCommitment(frozen)
            writable(frozen)
            const uploaded = recovered.status === 'CERTIFIED' ? recovered.result : await uploads.upload(
              new File([new Uint8Array(commitment.bytes)], `public-${frozen.kind}.json`, { type: 'application/json' }), scope, frozen.owner)
            check(uploaded, 'UPLOAD_RECEIPT_REQUIRED')
            const receipt = await validatePublicCommunityUploadReceipt(frozen, { schema: 'soulidity.community-upload.v1', intentHash: commitment.intentHash,
              reference: { blobId: uploaded.blobId, blobObjectId: uploaded.blobObjectId, sha256: uploaded.contentHash, byteLength: String(commitment.bytes.length) } })
            journal = { ...journal!, receipt }
            await lease.write(journal)
            await uploads.acknowledge(uploaded)
          } else if (recovered.status === 'CERTIFIED') {
            // A crash may occur after saving the parent receipt but before the
            // child's acknowledgement. Reconcile the same receipt then retry it.
            const uploaded = recovered.result
            check(uploaded && uploaded.blobId === journal!.receipt.reference.blobId
              && uploaded.blobObjectId === journal!.receipt.reference.blobObjectId
              && uploaded.contentHash === journal!.receipt.reference.sha256, 'RECOVERED_UPLOAD_MISMATCH')
            await uploads.acknowledge(uploaded)
          }
          writable(frozen)
          const prepared = await transaction.prepare(frozen, journal!.receipt!)
          const record = await runPublicCommunityPublishOperation({ intent: frozen, prepared, store: leased, adapter: transaction.adapter })
          return finish(record)
        })
      })
    },
  }
}
