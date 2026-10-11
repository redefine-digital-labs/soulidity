import { fromHex, normalizeSuiAddress, toHex } from '@mysten/sui/utils'
import { deriveMintContentObjectId, extractSkillBundleMetadata, hasZipSignature, normalizeTags,
  KIND_SOUL_DOC, KIND_MEMORY, KIND_SKILL } from '@soulidity/sdk'
import type { BatchSoulUploadFile } from '../upload/client-upload'
import { parseSoulAuthoringRequest, parseSoulAuthoringTarget, type SoulAuthoringMint,
  type SoulAuthoringSlot, type SoulAuthoringTarget } from './soul-authoring-manifest'

/** The original Collection form: numbered folders are one-based, separate from
 * the ordered metadata rows. No File, plaintext key or callback enters intent. */
export interface CollectionAuthoringInput {
  coverImageFile?: File | null
  name: string; description: string; extraRoyaltyBps: number; tradeable: boolean
  floorPriceAtomic?: string | null; maxSupply?: number | null
  collectionRightListing?: { priceAtomic: string } | null
  souls?: { name: string; description: string; tags: string[]; creatorRoyaltyBps: number }[]
  soulFolders?: Map<number, { characterFile: File; memoryFile: File; imageFile?: File; skillsFile?: File }>
}
const nonce = () => toHex(crypto.getRandomValues(new Uint8Array(16)))
const mime: Record<string, string> = { md: 'text/markdown', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', json: 'application/json', zip: 'application/zip' }
function fileType(file: File) {
  const type = mime[file.name.split('.').pop()!.toLowerCase()]
  return !type || file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified })
}

/** Pure preparation of the complete original Collection launch. Snapshots form
 * metadata and immutable Files before any await. The caller must persist/encrypt
 * this one request before paying; resume reads it, never calls this builder again. */
export async function buildCollectionAuthoringInput(input: CollectionAuthoringInput, deployment: SoulAuthoringTarget,
  walletAddress: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const target = parseSoulAuthoringTarget(deployment), author = normalizeSuiAddress(walletAddress)
  const { coverImageFile: cover, soulFolders, ...metadata } = input
  const draft = structuredClone(metadata)
  const folders = new Map([...soulFolders ?? []].map(([index, folder]) => [index, { ...folder }]))
  if (!cover) throw new Error('Choose the original Collection cover before preparing its launch.')
  if (draft.maxSupply != null && (!Number.isSafeInteger(draft.maxSupply) || draft.maxSupply < 1))
    throw new Error('Collection supply must be a positive safe integer or unlimited.')
  const rows = draft.souls ?? []
  if (rows.length > 1000) throw new Error('Collection launch supports at most 1000 Soul rows.')
  for (const index of folders.keys()) if (!Number.isSafeInteger(index) || index < 1 || index > rows.length)
    throw new Error('A Soul folder does not match a numbered metadata row.')
  const files: BatchSoulUploadFile[] = []
  function add(file: File, encrypted: boolean, skill = false) {
    const index = files.length
    files.push({ file: fileType(file), uploadType: encrypted ? 'encrypted' : 'public',
      kind: encrypted ? 'soul-content' : 'persona-sprite', sendObjectTo: author,
      ...(skill ? { extractSkillMetadata: true } : {}) })
    return index
  }
  const coverIndex = add(cover, false), mints: SoulAuthoringMint[] = []
  const slot = (fileIndex: number, kind: number, name: string): SoulAuthoringSlot => ({ fileIndex, kind, name,
    versionIndex: '0', readModeMask: 3, downloadPolicy: 'public', setActive: false })
  for (const [index, soul] of rows.entries()) {
    const folder = folders.get(index + 1), mintNonce = nonce()
    // Preserve the existing metadata-only helper's character/memory seeds. The
    // original file-upload UI still requires real files; provided files win.
    const character = folder?.characterFile ?? new File([`# ${soul.name}\n\n${soul.description}\n`],
      `${soul.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`, { type: 'text/markdown' })
    const memory = folder?.memoryFile ?? new File([`${soul.name} memory.\n`], 'memory-seed.txt', { type: 'text/plain' })
    const slots = [slot(add(character, true), KIND_SOUL_DOC, 'soul'), slot(add(memory, true), KIND_MEMORY, 'default')]
    if (folder?.skillsFile) {
      const bytes = new Uint8Array(await folder.skillsFile.arrayBuffer()); signal.throwIfAborted()
      const skillName = hasZipSignature(bytes) ? extractSkillBundleMetadata(bytes).skillName || 'default' : 'default'
      slots.push(slot(add(folder.skillsFile, true, true), KIND_SKILL, skillName))
    }
    const image = { kind: 'FILE' as const, fileIndex: folder?.imageFile ? add(folder.imageFile, false) : coverIndex }
    mints.push({ kind: 'ORDINARY', mintNonce, contentObjectId: deriveMintContentObjectId({
      originalPackageId: target.originalPackageId, kioskRegistryId: target.kioskRegistryId, author, mintNonce: fromHex(mintNonce) }),
      name: soul.name, description: soul.description, creatorRoyaltyBps: soul.creatorRoyaltyBps,
      image, originRef: null, source: null, slots, publicPreview: { tags: normalizeTags(soul.tags), previewImages: [image] },
      stateConfig: [], listingPriceAtomic: null })
  }
  signal.throwIfAborted()
  const request = parseSoulAuthoringRequest({ schema: 'soulidity.soul-authoring-request.v1', target, author,
    operationId: nonce(), storageEpochs: 26, bindCollectionId: null,
    collection: { name: draft.name, description: draft.description, image: { kind: 'FILE', fileIndex: coverIndex },
      extraRoyaltyBps: draft.extraRoyaltyBps, tradeable: draft.tradeable,
      maxSupply: draft.maxSupply == null ? null : String(draft.maxSupply), floorPriceAtomic: draft.floorPriceAtomic ?? null,
      listingPriceAtomic: draft.collectionRightListing?.priceAtomic ?? null }, mints })
  return { request, files }
}
