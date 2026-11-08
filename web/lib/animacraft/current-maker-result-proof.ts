import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag, toHex } from '@mysten/sui/utils'
import { CanonicalSoulBcs } from '../soulidity/canonical-native-workbench'
import { readHistoricalMoveObject } from '../sui/historical-object'
import { readPinnedMovePackageOrigins, type PinnedMovePackage } from '../sui/pinned-move-package'
import { currentMakerHex, currentMakerId, currentMakerU64, validateCurrentMakerPackage } from './current-maker-transactions'

/** Historical Standard output subproof for the ORIGINAL Complete. The parent
 * must authenticate original packet/effects finality and attempt receipt. This
 * does not establish current ownership, child content or full delivery. */
export async function readCurrentMakerCreatedSoulProof(input: {
  client: SuiGrpcClient; signal: AbortSignal; isCurrent(): boolean
  effects: ReturnType<typeof bcs.TransactionEffects.parse>; transactionDigest: string; standard: PinnedMovePackage
  expected: { soulId: string; actor: string; makerId: string; version: string; policyHash: string; producerType: string; sourceType: string; name: string }
}) {
  const { client, signal, isCurrent } = input
  const { effects, transactionDigest, standard, expected: e } = structuredClone({ effects: input.effects,
    transactionDigest: input.transactionDigest, standard: input.standard, expected: input.expected })
  const check = (ok: unknown) => { if (!ok) throw Error('CURRENT_MAKER_CREATED_SOUL_MISMATCH') }
  const guard = () => { if (signal.aborted || !isCurrent()) throw Error('CURRENT_MAKER_RESULT_STALE: original output context changed') }
  guard(); validateCurrentMakerPackage(standard)
  currentMakerId(e.soulId); currentMakerId(e.actor); currentMakerId(e.makerId); currentMakerU64(e.version, true); currentMakerHex(e.policyHash, 32)
  const producer = normalizeStructTag(e.producerType), source = normalizeStructTag(e.sourceType)
  const origins = await readPinnedMovePackageOrigins(client, standard, signal); guard()
  const origin = origins.get('soul::Soul'); check(origin)
  const output = await readHistoricalMoveObject({ client, effects, transactionDigest, objectId: e.soulId,
    type: `${origin}::soul::Soul`, mode: 'created', signal, maxBytes: 256 * 1024 }); guard()
  const root = CanonicalSoulBcs.parse(output.bytes)
  check(toHex(CanonicalSoulBcs.serialize(root).toBytes()) === toHex(output.bytes))
  check(root.id === e.soulId && root.schema === 1 && BigInt(root.revision) > 0n && !root.editing && root.name === e.name)
  check(root.origin.source === e.makerId && root.origin.source_version === e.version && root.origin.minted_by === e.actor
    && toHex(root.origin.source_hash) === e.policyHash && normalizeStructTag(root.origin.producer.name) === producer
    && normalizeStructTag(root.origin.source_type.name) === source)
  check(output.reference.owner.AddressOwner === e.actor)
  return { authority: 'historical-current-maker-root-subproof-only' as const, transactionDigest, soulId: root.id,
    creatingRecipient: e.actor, moduleCount: root.modules.length, notCreationReceipt: true as const,
    notCurrentAuthority: true as const, requiresChildContentProof: true as const }
}
