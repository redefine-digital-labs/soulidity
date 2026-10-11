import { bcs } from '@mysten/sui/bcs'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { parseSoulAuthoringPreparation, soulAuthoringPreparationHash, soulAuthoringStoreKey,
  type SoulAuthoringPreparation } from './soul-authoring-store'
import type { SoulAuthoringKiosk, SoulAuthoringMintChunk } from './soul-authoring-transaction'
import { walrusBatchAddress, walrusBatchKeys } from '../upload/walrus-batch-preparation'
import { parseWalrusBatchParentPacket } from '../upload/walrus-batch-store'
import type { PublicMutationPacket } from '../sui/public-mutation-journal'
import { validateMarketCancelCheckpoint, type MarketCancelCheckpoint } from '../animacraft/market-cancel-checkpoint'

export type SoulAuthoringStep = { kind: 'REGISTER'; kiosk: SoulAuthoringKiosk }
  | { kind: 'MINT'; chunk: SoulAuthoringMintChunk }
export interface SoulAuthoringPacketPlan {
  parentKey: string; manifestHash: string; step: SoulAuthoringStep
}
export interface SoulAuthoringPacketRecord {
  schema: 'soulidity.soul-authoring-packet.v1'
  plan: SoulAuthoringPacketPlan
  packet: PublicMutationPacket
  retirement?: { priorPhase: 'PREPARED' | 'SIGNING' | 'SIGNED'; checkpoint: MarketCancelCheckpoint }
}
export function soulAuthoringPacketCheck(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`SOUL_AUTHORING_PACKET_${code}`)
}
const check: typeof soulAuthoringPacketCheck = soulAuthoringPacketCheck
export const soulAuthoringPacketKey = (plan: SoulAuthoringPacketPlan) => `${plan.parentKey}:packets`
function kiosk(k: SoulAuthoringKiosk) {
  walrusBatchKeys(k, ['kind', 'kioskId', 'capId'])
  check(k.kind === 'NEW' && k.kioskId === null && k.capId === null
    || k.kind === 'EXISTING' && walrusBatchAddress(k.kioskId) && walrusBatchAddress(k.capId) && k.kioskId !== k.capId, 'KIOSK_INVALID')
}
/** Local packet binding/shape, not proof of business commands or chain success.
 * The production adapter must verify the entire PTB before any wallet call. */
export function createSoulAuthoringPacketParser(input: SoulAuthoringPreparation) {
  const p = parseSoulAuthoringPreparation(input), request = p.manifest.request
  const parentKey = soulAuthoringStoreKey(request), manifestHash = soulAuthoringPreparationHash(p)
  function plan(input: unknown): SoulAuthoringPacketPlan {
    const value = structuredClone(input) as SoulAuthoringPacketPlan
    walrusBatchKeys(value, ['parentKey', 'manifestHash', 'step'])
    check(value.parentKey === parentKey && value.manifestHash === manifestHash, 'MANIFEST_BINDING')
    const s = value.step
    if (s?.kind === 'REGISTER') { walrusBatchKeys(s, ['kind', 'kiosk']); kiosk(s.kiosk) }
    else {
      walrusBatchKeys(s, ['kind', 'chunk']); check(s.kind === 'MINT', 'STEP_INVALID')
      const c = s.chunk; walrusBatchKeys(c, ['mintIndices', 'includePublicFiles', 'collectionObjectId', 'kiosk']); kiosk(c.kiosk)
      const coverOnly = request.mints.length === 0 && p.preparation.manifest.files.some(f => f.uploadType === 'public') && c.includePublicFiles
      check(Array.isArray(c.mintIndices) && (c.mintIndices.length > 0 || coverOnly) && c.mintIndices.length <= request.mints.length
        && c.mintIndices.every((index, i) => Number.isSafeInteger(index) && index >= 0 && index < request.mints.length
          && (i === 0 || index > c.mintIndices[i - 1])) && typeof c.includePublicFiles === 'boolean', 'MINT_INDICES')
      check(request.collection ? walrusBatchAddress(c.collectionObjectId) : c.collectionObjectId === request.bindCollectionId, 'COLLECTION_SCOPE')
    }
    return value
  }
  function parse(input: unknown): SoulAuthoringPacketRecord {
    const r = structuredClone(input) as SoulAuthoringPacketRecord
    walrusBatchKeys(r, r.retirement ? ['schema', 'plan', 'packet', 'retirement'] : ['schema', 'plan', 'packet'])
    check(r.schema === 'soulidity.soul-authoring-packet.v1', 'SCHEMA_INVALID'); r.plan = plan(r.plan)
    const packet = r.packet
    walrusBatchKeys(packet, ['bytes', 'digest', 'expirationEpoch', 'phase', 'signature'])
    parseWalrusBatchParentPacket({ bytes: packet.bytes, digest: packet.digest }, request.author)
    check(typeof packet.expirationEpoch === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(packet.expirationEpoch)
      && BigInt(packet.expirationEpoch) <= 18446744073709551615n, 'EXPIRATION_INVALID')
    const raw = bcs.TransactionData.parse(fromBase64(packet.bytes)).V1!
    check(String(raw.expiration.Epoch) === packet.expirationEpoch && BigInt(raw.gasData.budget) > 0n
      && BigInt(raw.gasData.price) > 0n, 'EXPIRATION_OR_GAS_MISMATCH')
    check(['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED'].includes(packet.phase), 'PHASE_INVALID')
    check((packet.phase === 'RETIRED') === Boolean(r.retirement), 'RETIREMENT_REQUIRED')
    if (r.retirement) {
      walrusBatchKeys(r.retirement, ['priorPhase', 'checkpoint'])
      check(['PREPARED', 'SIGNING', 'SIGNED'].includes(r.retirement.priorPhase), 'RETIREMENT_PHASE_INVALID')
      validateMarketCancelCheckpoint(r.retirement.checkpoint, packet.expirationEpoch)
      check(r.retirement.priorPhase === 'SIGNED' ? packet.signature !== null : packet.signature === null, 'RETIREMENT_SIGNATURE_INVALID')
    }
    check(packet.signature === null || typeof packet.signature === 'string' && packet.signature.length > 0
      && packet.signature.length <= 32768 && toBase64(fromBase64(packet.signature)) === packet.signature, 'SIGNATURE_INVALID')
    check(packet.phase !== 'SIGNED' || packet.signature !== null, 'SIGNATURE_REQUIRED')
    check(!['PREPARED', 'SIGNING', 'CANCELLED'].includes(packet.phase) || packet.signature === null, 'UNEXPECTED_SIGNATURE')
    return r
  }
  return { plan, parse, parentKey, manifestHash }
}
