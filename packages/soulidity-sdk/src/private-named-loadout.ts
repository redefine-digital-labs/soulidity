import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { deriveDynamicFieldID, fromBase64, fromHex, toBase64 } from '@mysten/sui/utils'

/** Release-selected public addresses. These values are not code attestation. */
export interface PrivateNamedLoadoutDeployment {
  originalPackageId: string
  callablePackageId: string
  chainIdentifier: string
}

/** A transfer, including a transfer back, starts a distinct private library. */
export interface PrivateNamedLoadoutScope {
  soulId: string
  stateId: string
  owner: string
  ownershipEpoch: string
}

export const PRIVATE_NAMED_LOADOUT_MAX_U64 = 18446744073709551615n
export const PRIVATE_NAMED_LOADOUT_MAX_CIPHERTEXT_BYTES = 16_777_216
export const PRIVATE_NAMED_LOADOUT_MAX_RECEIPTS = 32
export const PRIVATE_NAMED_LOADOUT_SEAL_DOMAIN = 'soulidity/private-named-loadouts/seal-id/v1'

export interface PrivateNamedLoadoutCipherRef {
  blobObjectId: string
  blobId: string
  sha256: string
  byteLength: string
}
export interface PrivateNamedLoadoutCapture {
  equipmentId: string
  revision: string
  commitment: string
}
export interface PrivateNamedLoadoutReceipt {
  requestId: string
  revision: string
  ciphertext: Readonly<PrivateNamedLoadoutCipherRef>
  capture: Readonly<PrivateNamedLoadoutCapture> | null
}
export interface PrivateNamedLoadoutHead {
  scope: Readonly<PrivateNamedLoadoutScope>
  revision: string
  ciphertext: Readonly<PrivateNamedLoadoutCipherRef>
  receipts: readonly Readonly<PrivateNamedLoadoutReceipt>[]
}

const A = bcs.Address, U = bcs.u64(), V = bcs.vector(bcs.u8())
export const PrivateNamedLoadoutHeadKeyV1Bcs = bcs.struct('NamedLoadoutHeadKeyV1', { version: bcs.u8() })
export const PrivateNamedLoadoutCipherRefV1Bcs = bcs.struct('CipherRefV1', {
  blob_object_id: A, blob_id: bcs.string(), sha256: V, byte_length: U,
})
export const PrivateNamedLoadoutCaptureV1Bcs = bcs.struct('CaptureV1', {
  equipment_id: A, revision: U, commitment: V,
})
export const PrivateNamedLoadoutReceiptV1Bcs = bcs.struct('ReceiptV1', {
  request_id: V, revision: U, ciphertext: PrivateNamedLoadoutCipherRefV1Bcs,
  capture: bcs.option(PrivateNamedLoadoutCaptureV1Bcs),
})
export const PrivateNamedLoadoutHeadV1Bcs = bcs.struct('HeadV1', {
  version: bcs.u8(), soul_id: A, state_id: A, owner: A, ownership_epoch: U, revision: U,
  ciphertext: PrivateNamedLoadoutCipherRefV1Bcs, receipts: bcs.vector(PrivateNamedLoadoutReceiptV1Bcs),
})
export const PrivateNamedLoadoutHeadFieldV1Bcs = bcs.struct('NamedLoadoutHeadFieldV1', {
  id: A, name: PrivateNamedLoadoutHeadKeyV1Bcs, value: PrivateNamedLoadoutHeadV1Bcs,
})
export const PrivateNamedLoadoutSealScopeV1Bcs = bcs.struct('SealScopeV1', {
  domain: bcs.string(), version: bcs.u8(), soul_id: A, state_id: A, owner: A, ownership_epoch: U,
})

export function privateNamedLoadoutCheck(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`PRIVATE_NAMED_LOADOUT_${code}`)
}

export function assertPrivateNamedLoadoutId(value: unknown): asserts value is string {
  privateNamedLoadoutCheck(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value)
    && !/^0x0+$/.test(value), 'INVALID_ID')
}

export function assertPrivateNamedLoadoutU64(value: unknown): asserts value is string {
  privateNamedLoadoutCheck(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)
    && BigInt(value) <= PRIVATE_NAMED_LOADOUT_MAX_U64, 'INVALID_U64')
}

export function assertPrivateNamedLoadoutHash(value: unknown): asserts value is string {
  privateNamedLoadoutCheck(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
    && !/^0+$/.test(value), 'INVALID_HASH')
}

function exact(value: unknown, fields: readonly string[]) {
  privateNamedLoadoutCheck(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)), 'INVALID_FIELDS')
}

export function assertPrivateNamedLoadoutDeployment(input: PrivateNamedLoadoutDeployment): Readonly<PrivateNamedLoadoutDeployment> {
  const value = structuredClone(input)
  exact(value, ['originalPackageId', 'callablePackageId', 'chainIdentifier'])
  assertPrivateNamedLoadoutId(value.originalPackageId)
  assertPrivateNamedLoadoutId(value.callablePackageId)
  privateNamedLoadoutCheck(typeof value.chainIdentifier === 'string' && /^[0-9a-f]{8}$/.test(value.chainIdentifier), 'INVALID_CHAIN')
  return Object.freeze(value)
}

export function assertPrivateNamedLoadoutScope(input: PrivateNamedLoadoutScope): Readonly<PrivateNamedLoadoutScope> {
  const value = structuredClone(input)
  exact(value, ['soulId', 'stateId', 'owner', 'ownershipEpoch'])
  assertPrivateNamedLoadoutId(value.soulId)
  assertPrivateNamedLoadoutId(value.stateId)
  assertPrivateNamedLoadoutId(value.owner)
  assertPrivateNamedLoadoutU64(value.ownershipEpoch)
  privateNamedLoadoutCheck(value.soulId !== value.stateId && value.owner !== value.soulId
    && value.owner !== value.stateId, 'SCOPE_ALIAS')
  return Object.freeze(value)
}

export function assertPrivateNamedLoadoutCipherRef(input: PrivateNamedLoadoutCipherRef): Readonly<PrivateNamedLoadoutCipherRef> {
  const value = structuredClone(input)
  exact(value, ['blobObjectId', 'blobId', 'sha256', 'byteLength'])
  assertPrivateNamedLoadoutId(value.blobObjectId)
  assertPrivateNamedLoadoutHash(value.sha256)
  assertPrivateNamedLoadoutU64(value.byteLength)
  privateNamedLoadoutCheck(BigInt(value.byteLength) > 0n
    && BigInt(value.byteLength) <= BigInt(PRIVATE_NAMED_LOADOUT_MAX_CIPHERTEXT_BYTES), 'CIPHERTEXT_BUDGET')
  privateNamedLoadoutCheck(typeof value.blobId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.blobId), 'INVALID_BLOB_ID')
  const bytes = fromBase64(value.blobId.replaceAll('-', '+').replaceAll('_', '/') + '=')
  privateNamedLoadoutCheck(bytes.length === 32 && toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') === value.blobId,
    'INVALID_BLOB_ID')
  return Object.freeze(value)
}

export function assertPrivateNamedLoadoutCapture(input: PrivateNamedLoadoutCapture): Readonly<PrivateNamedLoadoutCapture> {
  const value = structuredClone(input)
  exact(value, ['equipmentId', 'revision', 'commitment'])
  assertPrivateNamedLoadoutId(value.equipmentId)
  assertPrivateNamedLoadoutU64(value.revision)
  assertPrivateNamedLoadoutHash(value.commitment)
  return Object.freeze(value)
}

export function derivePrivateNamedLoadoutHeadFieldId(originalPackageId: string, stateId: string): string {
  assertPrivateNamedLoadoutId(originalPackageId); assertPrivateNamedLoadoutId(stateId)
  return deriveDynamicFieldID(stateId, `${originalPackageId}::soul::NamedLoadoutHeadKeyV1`,
    PrivateNamedLoadoutHeadKeyV1Bcs.serialize({ version: 1 }).toBytes())
}

/** Matches Move SealScopeV1 exactly; no wallet-derived secret or head revision. */
export async function derivePrivateNamedLoadoutSealId(input: PrivateNamedLoadoutScope): Promise<Uint8Array> {
  const scope = assertPrivateNamedLoadoutScope(input)
  const bytes = PrivateNamedLoadoutSealScopeV1Bcs.serialize({ domain: PRIVATE_NAMED_LOADOUT_SEAL_DOMAIN,
    version: 1, soul_id: scope.soulId, state_id: scope.stateId, owner: scope.owner, ownership_epoch: scope.ownershipEpoch }).toBytes()
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))
}

export interface PrivateNamedLoadoutMutationParams {
  deployment: PrivateNamedLoadoutDeployment
  scope: PrivateNamedLoadoutScope
  expectedRevision: string
  requestId: string
  ciphertext: PrivateNamedLoadoutCipherRef
}

function mutation(input: PrivateNamedLoadoutMutationParams) {
  const p = structuredClone(input)
  const deployment = assertPrivateNamedLoadoutDeployment(p.deployment), scope = assertPrivateNamedLoadoutScope(p.scope)
  assertPrivateNamedLoadoutU64(p.expectedRevision); assertPrivateNamedLoadoutHash(p.requestId)
  privateNamedLoadoutCheck(BigInt(p.expectedRevision) < PRIVATE_NAMED_LOADOUT_MAX_U64, 'REVISION_EXHAUSTED')
  const ciphertext = assertPrivateNamedLoadoutCipherRef(p.ciphertext)
  const tx = new Transaction(); tx.setSender(scope.owner)
  const args = [tx.pure.u64(scope.ownershipEpoch), tx.pure.u64(p.expectedRevision), tx.pure.vector('u8', [...fromHex(p.requestId)]),
    tx.pure.id(ciphertext.blobObjectId), tx.pure.string(ciphertext.blobId), tx.pure.vector('u8', [...fromHex(ciphertext.sha256)]),
    tx.pure.u64(ciphertext.byteLength)]
  return { deployment, scope, tx, args }
}

/** A separate head CAS after paid certification. It does not upload or sign. */
export function buildUpdatePrivateNamedLoadoutTx(input: PrivateNamedLoadoutMutationParams): Transaction {
  const { deployment, scope, tx, args } = mutation(input)
  tx.moveCall({ target: `${deployment.callablePackageId}::named_loadout_v1::update`, arguments: [tx.object(scope.stateId), ...args] })
  return tx
}

export function buildSavePrivateNamedLoadoutTx(input: PrivateNamedLoadoutMutationParams & {
  protocolId: string; capture: PrivateNamedLoadoutCapture
}): Transaction {
  const p = structuredClone(input), capture = assertPrivateNamedLoadoutCapture(p.capture)
  assertPrivateNamedLoadoutId(p.protocolId)
  const { deployment, scope, tx, args } = mutation(p)
  privateNamedLoadoutCheck(new Set([scope.stateId, scope.soulId, p.protocolId, capture.equipmentId]).size === 4, 'CAPTURE_ALIAS')
  tx.moveCall({ target: `${deployment.callablePackageId}::named_loadout_v1::save`, arguments: [
    tx.object(scope.stateId), tx.object(capture.equipmentId), tx.object(p.protocolId), ...args,
    tx.pure.u64(capture.revision), tx.pure.vector('u8', [...fromHex(capture.commitment)]),
  ] })
  return tx
}

/** Read-only Seal TransactionKind; never submit it as a signed transaction. */
export async function buildPrivateNamedLoadoutSealApproval(input: {
  deployment: PrivateNamedLoadoutDeployment; scope: PrivateNamedLoadoutScope
}): Promise<Transaction> {
  const deployment = assertPrivateNamedLoadoutDeployment(input.deployment), scope = assertPrivateNamedLoadoutScope(input.scope)
  const sealId = await derivePrivateNamedLoadoutSealId(scope)
  const tx = new Transaction(); tx.setSender(scope.owner)
  tx.moveCall({ target: `${deployment.callablePackageId}::named_loadout_v1::seal_approve`, arguments: [
    tx.pure.vector('u8', [...sealId]), tx.object(scope.stateId), tx.pure.u64(scope.ownershipEpoch),
  ] })
  return tx
}
