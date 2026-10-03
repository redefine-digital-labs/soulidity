import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { profileReadStep } from '@soulidity/sdk'
import { toBase64 } from '@mysten/sui/utils'
import { collectionCommandChain } from '../collections/collection-command-state'
import { collectionCommandRaw } from '../collections/collection-command-plan'
import { historicalMoveObjectType } from '../sui/historical-object'
import type { SoulAuthoringRequest } from './soul-authoring-manifest'

/** REGISTER does not consume the source: check raw ownership/type before
 * payment and mint signing. This is not a promise of future ownership. */
export async function verifySoulAuthoringSources(client: SuiGrpcClient, request: SoulAuthoringRequest, signal: AbortSignal) {
  const sources = request.mints.filter(mint => mint.kind === 'JOINED').map(mint => mint.source!)
  if (!sources.length) return
  await collectionCommandChain(client, request.target, signal)
  for (const source of sources) {
    const { response } = await profileReadStep(signal, () => client.ledgerService.batchGetObjects({ requests: [{ objectId: source.objectId }],
      readMask: { paths: ['object_id', 'version', 'digest', 'owner', 'object_type', 'contents', 'previous_transaction', 'bcs'] } }, { abort: signal }))
    const row = response.objects.length === 1 ? response.objects[0].result : null
    if (row?.oneofKind !== 'object') throw new Error('The selected source asset is unavailable. No new payment is allowed.')
    if (!(row.object.bcs?.value instanceof Uint8Array)) throw new Error('Source asset bytes are unavailable.')
    const projected = { objectId: row.object.objectId!, version: String(row.object.version), digest: row.object.digest!, bcs: toBase64(row.object.bcs.value) }
    const raw = collectionCommandRaw(projected)
    if (projected.objectId !== source.objectId || raw.owner.$kind !== 'AddressOwner'
      || raw.owner.AddressOwner !== request.author || !raw.data.Move || !raw.data.Move.hasPublicTransfer
      || historicalMoveObjectType(raw.data.Move.type) !== source.objectType)
      throw new Error('The selected source asset no longer matches this wallet and type. No new payment is allowed.')
  }
  signal.throwIfAborted()
}
