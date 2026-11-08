import { bcs } from '@mysten/sui/bcs'
import { Transaction, type TransactionArgument } from '@mysten/sui/transactions'
import { deriveObjectID, fromHex, normalizeStructTag } from '@mysten/sui/utils'

/** Explicit independent package/object inputs. These are caller-selected
 * identities, not evidence that a deployment is current or authorized. */
export interface NativeCreationTarget {
  nativeOriginalPackageId: string
  nativeCallablePackageId: string
  custodyCallablePackageId: string
  registryId: string
  configId: string
  kindRegistryId: string
  soulTransferPolicyId: string
  walrusSystemId: string
  paymentCoinType: string
}
export type NativeCreationAccount = { kind: 'NEW' } | { kind: 'EXISTING'; kioskId: string; accountId: string }
export interface NativeCreationContent {
  blobObjectId: string
  kind: number
  name: string
  readMask: string
  downloadPolicy: number
  sha256: string
  nonce: string
  envelope: number[]
  setActive: boolean
}
export interface NativeCreationIntent {
  schema: 'soulidity.native-creation.v1'
  target: NativeCreationTarget
  author: string
  mintNonce: string
  expectedContentId: string
  account: NativeCreationAccount
  name: string
  description: string
  image: string
  royaltyBps: number
  configuration: { key: string; value: number[] }[]
  content: NativeCreationContent[]
}
/** New Host/Link format only. Never deserialize a v1 signed operation as V2.
 * The candidate ABI is not adopted or deployed by creating this intent. */
export type NativePublicReadCreationIntentV2 = Omit<NativeCreationIntent, 'schema'> & {
  schema: 'soulidity.native-public-read-creation.v2'
}
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`NATIVE_CREATION_${code}`) }
function keys(value: object, expected: string[]) {
  check(value && Object.keys(value).sort().join(',') === expected.sort().join(','), 'FIELDS_INVALID')
}
function id(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && BigInt(value) !== 0n, 'ID_INVALID')
}
function hex(value: unknown, bytes: number) { check(typeof value === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value), 'BYTES_INVALID') }
function bytes(value: unknown, max: number): asserts value is number[] {
  check(Array.isArray(value) && value.length <= max && value.every(b => Number.isInteger(b) && b >= 0 && b <= 255), 'BYTES_INVALID')
}
function text(value: unknown, max: number, required = false): asserts value is string {
  check(typeof value === 'string' && (!required || value.trim().length > 0)
    && new TextEncoder().encode(value).length <= max
    && new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(value)) === value, 'TEXT_INVALID')
}
function uint(value: unknown) {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n, 'INTEGER_INVALID')
}
const ContentMintKey = bcs.struct('ContentMintKey', { author: bcs.Address, nonce: bcs.vector(bcs.u8()) })
const ContentNamespace = bcs.struct('Namespace', { domain: bcs.vector(bcs.u8()), schema: bcs.u16(),
  content: bcs.Address, kind: bcs.u32(), name: bcs.string(), version: bcs.u64(), nonce: bcs.vector(bcs.u8()) })
/** Exact canonical Content document namespace, not the retired SDK's flat
 * big-endian document-id layout. Seal encryption must use these bytes before
 * upload; a matching content ID alone does not make an old envelope readable. */
export function nativeCreationSealNamespace(contentId: string, kind: number, name: string, nonce: string) {
  return nativeContentSealNamespace(contentId, kind, name, nonce, '0')
}
export function nativeContentSealNamespace(contentId: string, kind: number, name: string, nonce: string, version: string) {
  uint(version)
  id(contentId); hex(nonce, 16)
  check(Number.isInteger(kind) && kind >= 0 && kind <= 4294967295, 'KIND_INVALID')
  check(/^[a-z0-9_-]{1,32}$/.test(name) && (kind !== 0 || name === 'soul')
    && (kind !== 1 || name === 'default'), 'CONTENT_NAME_INVALID')
  return ContentNamespace.serialize({ domain: [...new TextEncoder().encode('soulidity-content')], schema: 1,
    content: contentId, kind, name, version, nonce: fromHex(nonce) }).toBytes()
}
/** Canonical Native uses registry::ContentMintKey, not market::ContentMintKeyV1.
 * Reuse this exact persisted nonce across storage, mint and recovery. */
export function deriveNativeCreationContentId(target: NativeCreationTarget, author: string, nonce: string) {
  id(target.nativeOriginalPackageId); id(target.registryId); id(author); hex(nonce, 16)
  return deriveObjectID(target.registryId, `${target.nativeOriginalPackageId}::registry::ContentMintKey`,
    ContentMintKey.serialize({ author, nonce: fromHex(nonce) }).toBytes())
}
export function parseNativeCreationTarget(input: unknown): NativeCreationTarget {
  const t = structuredClone(input) as NativeCreationTarget
  check(t && Object.keys(t).sort().join(',') === ['nativeOriginalPackageId', 'nativeCallablePackageId', 'custodyCallablePackageId',
    'registryId', 'configId', 'kindRegistryId', 'soulTransferPolicyId', 'walrusSystemId', 'paymentCoinType'].sort().join(','), 'TARGET_INVALID')
  for (const [key, value] of Object.entries(t)) if (key !== 'paymentCoinType') id(value)
  check(typeof t.paymentCoinType === 'string' && normalizeStructTag(t.paymentCoinType) === t.paymentCoinType, 'COIN_TYPE_INVALID')
  return t
}
export function parseNativeCreationIntent(input: NativeCreationIntent): NativeCreationIntent {
  return parseCreationIntent(input, 'soulidity.native-creation.v1')
}
export function parseNativePublicReadCreationIntentV2(input: NativePublicReadCreationIntentV2): NativePublicReadCreationIntentV2 {
  return parseCreationIntent(input, 'soulidity.native-public-read-creation.v2')
}
function parseCreationIntent<T extends NativeCreationIntent | NativePublicReadCreationIntentV2>(input: T, schema: T['schema']): T {
  const p = structuredClone(input)
  keys(p, ['schema', 'target', 'author', 'mintNonce', 'expectedContentId', 'account', 'name', 'description', 'image', 'royaltyBps', 'configuration', 'content'])
  check(p.schema === schema, 'SCHEMA_INVALID')
  const t = p.target = parseNativeCreationTarget(p.target)
  id(p.author); id(p.expectedContentId); hex(p.mintNonce, 16)
  check(deriveNativeCreationContentId(t, p.author, p.mintNonce) === p.expectedContentId, 'CONTENT_ID_MISMATCH')
  check(p.account?.kind === 'NEW' || p.account?.kind === 'EXISTING', 'ACCOUNT_INVALID')
  keys(p.account, p.account.kind === 'NEW' ? ['kind'] : ['kind', 'kioskId', 'accountId'])
  if (p.account.kind === 'EXISTING') {
    id(p.account.kioskId); id(p.account.accountId); check(p.account.kioskId !== p.account.accountId, 'ACCOUNT_ALIAS')
  }
  text(p.name, 1024, true); text(p.description, 4096); text(p.image, 2048)
  check(Number.isInteger(p.royaltyBps) && p.royaltyBps >= 0 && p.royaltyBps <= 10000, 'ROYALTY_INVALID')
  check(Array.isArray(p.configuration) && p.configuration.length <= 128, 'CONFIGURATION_INVALID')
  for (const entry of p.configuration) {
    keys(entry, ['key', 'value'])
    text(entry.key, 1024, true); bytes(entry.value, 65536)
    check(!entry.key.startsWith('content_seal_envelope_v1:'), 'RESERVED_CONFIGURATION')
  }
  check(Array.isArray(p.content) && p.content.length >= 2 && p.content.length <= 128, 'FOUNDING_CONTENT_REQUIRED')
  const blobs = new Set<string>(), slots = new Set<string>()
  const reserved = new Set([p.author, p.expectedContentId, '0x' + '6'.padStart(64, '0'), t.registryId, t.configId, t.kindRegistryId, t.soulTransferPolicyId, t.walrusSystemId,
    ...(p.account.kind === 'EXISTING' ? [p.account.kioskId, p.account.accountId] : [])])
  for (const entry of p.content) {
    keys(entry, ['blobObjectId', 'kind', 'name', 'readMask', 'downloadPolicy', 'sha256', 'nonce', 'envelope', 'setActive'])
    id(entry.blobObjectId); check(!blobs.has(entry.blobObjectId) && !reserved.has(entry.blobObjectId), 'BLOB_ALIAS'); blobs.add(entry.blobObjectId)
    check(Number.isInteger(entry.kind) && entry.kind >= 0 && entry.kind <= 4294967295, 'KIND_INVALID')
    check(typeof entry.name === 'string' && /^[a-z0-9_-]{1,32}$/.test(entry.name)
      && (entry.kind !== 0 || entry.name === 'soul') && (entry.kind !== 1 || entry.name === 'default'), 'CONTENT_NAME_INVALID')
    // Initial page supplies version zero once per slot. Subsequent versions use
    // a separate content-management intent, never another creation operation.
    const key = `${entry.kind}:${entry.name}`; check(!slots.has(key), 'DUPLICATE_INITIAL_SLOT'); slots.add(key)
    uint(entry.readMask); check(BigInt(entry.readMask) > 0n, 'READ_MASK_INVALID')
    if (entry.kind === 0 || entry.kind === 1) check(entry.readMask === '3' && entry.downloadPolicy === 0 && !entry.setActive, 'FOUNDING_READ_MASK')
    check(Number.isInteger(entry.downloadPolicy) && entry.downloadPolicy >= 0 && entry.downloadPolicy <= 2, 'DOWNLOAD_POLICY_INVALID')
    hex(entry.sha256, 32); hex(entry.nonce, 16); bytes(entry.envelope, 65536)
    check(entry.envelope.length > 0 && typeof entry.setActive === 'boolean', 'ENVELOPE_INVALID')
  }
  check(slots.has('0:soul') && slots.has('1:default'), 'FOUNDING_CONTENT_REQUIRED')
  return p
}

/** Canonical suffix for the existing Web authoring pipeline. Caller must first
 * verify storage certificates, current package/object/authority inputs and the
 * complete built packet, then persist it before any wallet request. No network,
 * storage payment, signing or receipt-success inference happens here. */
export function createNativeCreationComposer(input: NativeCreationIntent) {
  return creationComposer(parseNativeCreationIntent(input), false)
}
/** Explicit unsigned suffix for the unadopted Host V2 candidate. Requires its
 * own interface/source qualification and packet/storage/authority verification.
 * Existing Accounts are consumed by birth::finish_existing_public_read_v2;
 * this must never be selected while recovering a stored v1 operation. */
export function createNativePublicReadCreationComposerV2(input: NativePublicReadCreationIntentV2) {
  return creationComposer(parseNativePublicReadCreationIntentV2(input), true)
}
function creationComposer<T extends NativeCreationIntent | NativePublicReadCreationIntentV2>(p: T, publicReadV2: boolean) {
  const t = p.target
  return {
    intent: () => structuredClone(p),
    append(tx: Transaction) {
      check(!tx.getData().sender || tx.getData().sender === p.author, 'SENDER_MISMATCH')
      tx.setSenderIfNotSet(p.author)
      let kiosk: TransactionArgument, account: TransactionArgument
      if (p.account.kind === 'NEW') [kiosk, account] = tx.moveCall({ target: `${t.custodyCallablePackageId}::account::new` })
      else { kiosk = tx.object(p.account.kioskId); account = tx.object(p.account.accountId) }
      const registry = tx.object(t.registryId), config = tx.object(t.configId), types = [t.paymentCoinType]
      const call = (name: string, args: TransactionArgument[]) => tx.moveCall({ target: `${t.nativeCallablePackageId}::account_creation::${name}`, typeArguments: types, arguments: args })
      call('register', [registry, config, kiosk, account])
      const claim = call('prepare_native', [registry, config, kiosk, account,
        tx.pure.vector('u8', fromHex(p.mintNonce)), tx.pure.id(p.expectedContentId)])
      const draft = call('begin', [claim, registry, config, kiosk, account, tx.pure.string(p.name),
        tx.pure.string(p.description), tx.pure.string(p.image), tx.pure.u16(p.royaltyBps),
        tx.pure.vector('string', p.configuration.map(v => v.key)), tx.pure(bcs.vector(bcs.vector(bcs.u8())).serialize(p.configuration.map(v => v.value))), tx.object('0x6')])
      for (const entry of p.content) tx.moveCall({ target: `${t.nativeCallablePackageId}::birth::append_initial`, arguments: [
        draft, tx.object(t.kindRegistryId), tx.pure.u32(entry.kind), tx.pure.string(entry.name), tx.pure.u64(entry.readMask),
        tx.pure.u8(entry.downloadPolicy), tx.object(entry.blobObjectId), tx.object(t.walrusSystemId),
        tx.pure.vector('u8', fromHex(entry.sha256)), tx.pure.vector('u8', fromHex(entry.nonce)),
        tx.pure.vector('u8', entry.envelope), tx.pure.u64(0), tx.pure.bool(entry.setActive), tx.object('0x6'),
      ] })
      const finishArgs = [draft, registry, config, kiosk, account, tx.object(t.soulTransferPolicyId), tx.object(t.walrusSystemId)]
      if (publicReadV2) return tx.moveCall({ target: `${t.nativeCallablePackageId}::birth::${p.account.kind === 'NEW' ? 'finish_fresh_public_read_v2' : 'finish_existing_public_read_v2'}`,
        typeArguments: types, arguments: finishArgs })
      return call(p.account.kind === 'NEW' ? 'finish_fresh' : 'finish', finishArgs)
    },
  }
}
