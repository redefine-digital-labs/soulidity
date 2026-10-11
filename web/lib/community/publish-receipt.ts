import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, toBase58, toBase64, toHex } from '@mysten/sui/utils'
import { CommentV1Bcs, PostV1Bcs, parsePublicCommunityPublishOperation, profileReadStep,
  type PublicCommunityPublishOperation } from '@soulidity/sdk'
import { readHistoricalMoveObject } from '../sui/historical-object'

function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`COMMUNITY_PUBLISH_RECEIPT_${code}`)
}
const MAX_U64 = 18446744073709551615n

/** A publication link is established by the original successful transaction's
 * created output, including its full Object digest; current objects and events
 * cannot establish the identity of a recovered publication. */
export async function readCommunityPublicationResult(params: {
  client: SuiGrpcClient; record: PublicCommunityPublishOperation; signal?: AbortSignal
}): Promise<{ kind: 'post' | 'comment'; postId: string; commentId: string | null; digest: string }> {
  const { client } = params, signal = params.signal ?? AbortSignal.timeout(30000)
  const record = await parsePublicCommunityPublishOperation(params.record)
  const { intent } = record
  const chain = await profileReadStep(signal, () => client.core.getChainIdentifier())
  const chainBytes = fromBase58(chain.chainIdentifier)
  check(chainBytes.length === 32 && toBase58(chainBytes) === chain.chainIdentifier
    && toHex(chainBytes.subarray(0, 4)) === intent.deployment.profile.chainIdentifier, 'WRONG_CHAIN')
  const { response } = await profileReadStep(signal, () => client.ledgerService.getTransaction({ digest: record.digest,
    readMask: { paths: ['digest', 'transaction.digest', 'transaction.bcs', 'effects.bcs',
      'effects.transaction_digest', 'effects.status', 'checkpoint'] } }, { abort: signal }))
  const row = structuredClone(response.transaction)
  check(row?.digest === record.digest && row.transaction?.digest === record.digest
    && row.transaction.bcs?.value && toBase64(row.transaction.bcs.value) === record.bytes
    && row.effects?.transactionDigest === record.digest && row.effects.bcs?.value, 'TRANSACTION_MISMATCH')
  check(typeof row.checkpoint === 'bigint' && row.checkpoint >= 0n && row.checkpoint <= MAX_U64, 'CHECKPOINT_REQUIRED')
  const raw = row.effects.bcs.value, effects = bcs.TransactionEffects.parse(raw), e = effects.V2
  check(toBase64(bcs.TransactionEffects.serialize(effects).toBytes()) === toBase64(raw), 'NONCANONICAL_EFFECTS')
  check(e && e.transactionDigest === record.digest && e.status.$kind === 'Success'
    && row.effects.status?.success === true && BigInt(e.executedEpoch) <= BigInt(record.expirationEpoch), 'SUCCESS_REQUIRED')
  // This exact one-command PTB creates one shared Post or one immutable Comment.
  // Table/index outputs have object ownership. Never discard a failed candidate
  // proof and accept another output or an unauthenticated event instead.
  const candidates = e.changedObjects.filter(([, change]) => change.idOperation.$kind === 'Created'
    && change.outputState.ObjectWrite?.[1].$kind === (intent.kind === 'post' ? 'Shared' : 'Immutable'))
  check(candidates.length === 1, 'CREATED_OUTPUT_NOT_UNIQUE')
  const objectId = candidates[0][0]
  const proof = await readHistoricalMoveObject({ client, effects, transactionDigest: record.digest, objectId,
    type: `${intent.deployment.profile.originalPackageId}::community_posts::${intent.kind === 'post' ? 'PostV1' : 'CommentV1'}`,
    mode: 'created', signal, maxBytes: 2048 })
  const value = intent.kind === 'post' ? PostV1Bcs.parse(proof.bytes) : CommentV1Bcs.parse(proof.bytes)
  const serialized = 'post_type' in value ? PostV1Bcs.serialize(value).toBytes() : CommentV1Bcs.serialize(value).toBytes()
  check(toBase64(serialized) === toBase64(proof.bytes), 'NONCANONICAL_CONTENTS')
  check(value.id === objectId && value.version === '1' && value.registry_id === intent.deployment.registryId
    && value.profile_registry_id === intent.deployment.profile.registryId && value.author === intent.authorId
    && value.author_owner === intent.owner, 'IDENTITY_MISMATCH')
  const document = value.document, reference = record.receipt.reference
  check(document.blob_object_id === reference.blobObjectId
    && toBase64(new Uint8Array(document.blob_id)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') === reference.blobId
    && toHex(new Uint8Array(document.sha256)) === reference.sha256 && document.byte_length === reference.byteLength, 'DOCUMENT_MISMATCH')
  const identities = [objectId, value.registry_id, value.profile_registry_id, value.author]
  if (intent.kind === 'post' && 'post_type' in value) {
    check(proof.reference.owner.Shared?.initialSharedVersion === String(proof.reference.version)
      && value.post_type === intent.postType && value.channel === intent.channel, 'POST_CATEGORY_OR_OWNER_MISMATCH')
    check(value.comment_count === '0' && value.comments_by_index.size === '0' && value.accepted_comment_id === null
      && value.acceptance_revision === '0' && value.created_at_ms === value.updated_at_ms, 'POST_INITIAL_STATE_MISMATCH')
    identities.push(value.comments_by_index.id)
  } else {
    check(intent.kind === 'comment' && 'post_id' in value && value.post_id === intent.postId
      && proof.reference.owner.$kind === 'Immutable', 'COMMENT_PARENT_OR_OWNER_MISMATCH')
    identities.push(value.post_id)
  }
  check(identities.every(id => /^0x[0-9a-f]{64}$/.test(id) && !/^0x0+$/.test(id))
    && new Set(identities).size === identities.length, 'NAMESPACE_MISMATCH')
  return { kind: intent.kind, postId: intent.kind === 'post' ? objectId : intent.postId,
    commentId: intent.kind === 'comment' ? objectId : null, digest: record.digest }
}
