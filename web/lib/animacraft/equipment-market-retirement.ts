import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { normalizeStructTag } from '@mysten/sui/utils'
import { collectionCommandRaw } from '../collections/collection-command-plan'
import { historicalMoveObjectType } from '../sui/historical-object'
import { readEpochExpiry } from '../sui/epoch-expiry'
import { readPinnedMovePackage } from '../sui/pinned-move-package'
import { proveExplicitInputConflict } from '../soulidity/commerce/explicit-gas-conflict'
import { readIndexedRetirementSnapshot } from '../soulidity/commerce/indexed-retirement-snapshot'
import { MAINNET_GENESIS_DIGEST } from './mainnet-chain'
import { marketListCanonical as canonical, marketListCheck as check, marketListDigest } from './market-list-operation'
import { equipmentRetirementInputs, validateEquipmentMarketOperationRecord } from './equipment-market-operation'
import type { EquipmentMarketOperationRecord, EquipmentRetirementWitness } from './equipment-market-operation-types'
import { proveEquipmentListingRetirement } from './equipment-listing-retirement'

const prefix = 'EQUIPMENT_RETIREMENT'

export async function verifyEquipmentMarketRetirement(input: {
  client: SuiGrpcClient; record: EquipmentMarketOperationRecord; signal: AbortSignal; conflictDigest?: string
  queryOriginal: () => Promise<string>
}): Promise<NonNullable<EquipmentMarketOperationRecord['retirement']> & { witness: EquipmentRetirementWitness }> {
  const { client, signal, conflictDigest, queryOriginal } = input
  const r = validateEquipmentMarketOperationRecord(input.record), s = r.snapshot, saved = r.retirement?.witness
  check(r.phase === 'SIGNING' || r.phase === 'SIGNED' || r.phase === 'RETIRED', 'Only an unresolved component operation can retire')
  check(conflictDigest === undefined || !saved && marketListDigest(conflictDigest) && conflictDigest !== r.digest,
    'Invalid or already recorded component conflict digest')
  const { refs, gas } = equipmentRetirementInputs(r)
  const primary = refs.find(ref => ref.objectId === saved?.objectId) ?? refs[0]
  const objectId = primary?.objectId ?? s.listing!.id
  const candidate = saved?.conflict?.digest ?? conflictDigest
  const indexed = candidate === undefined ? await readIndexedRetirementSnapshot({
    packet: r, objectId, signal, prefix, saved: saved && r.retirement?.checkpoint,
  }) : undefined
  const checkpoint = await readEpochExpiry(client, r.expirationEpoch, signal, MAINNET_GENESIS_DIGEST,
    saved && r.retirement?.checkpoint, prefix, indexed && String(indexed.sequenceNumber))
  check(!indexed || checkpoint.digest === indexed.digest && checkpoint.epoch === String(indexed.epoch?.epochId),
    'Indexed and executed component checkpoints differ')
  const object = indexed?.query.object
  let witness: EquipmentRetirementWitness
  if (!primary) {
    witness = await proveEquipmentListingRetirement({ client, signal, record: r, checkpoint, candidate, observed: object })
  } else {
    let type = gas ? '0x2::coin::Coin<0x2::sui::SUI>' : `0x2::coin::Coin<${s.target.paymentCoinType}>`
    if (!gas && r.action === 'list') {
      const runtime = await readPinnedMovePackage(client, s.release.runtime!, signal)
      const name = s.asset.kind === 'base' ? 'OwnedBaseItemV8' : 'OwnedExternalItemV8'
      const origin = runtime.origins.get('runtime_v8::' + name)
      check(origin, 'Component retirement owned item origin missing')
      type = `${origin}::runtime_v8::${name}`
    }
    type = normalizeStructTag(type)
    const ownedTypes = new Map(refs.map(ref => [ref.objectId, type]))
    const proof = async (locator: Parameters<typeof proveExplicitInputConflict>[0]['candidate']) => {
      const previous = saved?.conflict && { ...saved.conflict, coinId: saved.objectId }
      const conflict = await proveExplicitInputConflict({ client, signal, author: s.actor, originalDigest: r.digest,
        maxCheckpoint: checkpoint.sequenceNumber, candidate: locator, originalRefs: refs, ownedTypes, saved: previous, prefix })
      return { kind: 'OWNED' as const, objectId: conflict.coinId, conflict: { digest: conflict.digest, checkpoint: conflict.checkpoint } }
    }
    if (candidate !== undefined) witness = await proof(candidate)
    else {
      check(object?.address === objectId && Number.isSafeInteger(object.version) && BigInt(object.version!) >= BigInt(primary.version)
        && typeof object.digest === 'string' && typeof object.objectBcs === 'string' && object.objectBcs.length <= 16384,
      'Indexed component retirement input unavailable; supply the conflicting transaction digest')
      const version = String(object.version), unchanged = version === String(primary.version)
      check(unchanged ? object.digest === primary.digest : !saved && object.digest !== primary.digest, 'Indexed component input version or digest changed')
      const raw = collectionCommandRaw({ objectId, version, digest: object.digest, bcs: object.objectBcs })
      check(raw.data.Move && historicalMoveObjectType(raw.data.Move.type) === type
        && raw.owner.AddressOwner && (!unchanged || raw.owner.AddressOwner === s.actor), 'Indexed component input type or owner mismatch')
      witness = unchanged ? { kind: 'OWNED', objectId } : await proof({ version, digest: object.digest, writer: raw.previousTransaction })
    }
  }
  check(!saved || canonical(saved) === canonical(witness), 'Saved component retirement witness changed')
  check(await queryOriginal() === 'MISSING', 'Original component transaction appeared during expiry verification')
  signal.throwIfAborted()
  return { checkpoint, witness, priorPhase: r.retirement?.priorPhase ?? (r.phase as 'SIGNING' | 'SIGNED') }
}
