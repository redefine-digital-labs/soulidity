import { snapshotMintContentIdentity } from '../mint-content-identity'
import { Transaction, type TransactionArgument } from '@mysten/sui/transactions'
import { normalizeStructTag } from '@mysten/sui/utils'
import { appendFinalizeSoulState, buildInitialContentArgs, type MintPtbInputs } from './mint-helpers'
import {
  buildBuyerKioskArgs, finishBuyerKioskArgs, getUtf8ByteLength,
  MAX_NAME_BYTES, MAX_DESCRIPTION_BYTES,
  validateInitialContentEntries, validateInitialStateConfigEntries,
} from './shared'

/**
 * Expected deployment metadata only, NOT a live Core attestation.
 * Original IDs name the first package version; defining IDs name the version
 * introducing each type, not the latest callable code. Pin callable code separately.
 */
export interface AnimacraftV8NativeBindingMetadata {
  soulOriginalType: string
  soulDefiningType: string
  mintWitnessOriginalType: string
  mintWitnessDefiningType: string
  ownerWitnessOriginalType: string
  ownerWitnessDefiningType: string
}

export interface AnimacraftV8NativeMintIntegration {
  soulidityCallablePackageId: string
  soulidityOriginalPackageId: string
  kioskPackageId: string
  marketConfigV2Id: string
  kindRegistryId: string
  kioskRegistryId: string
  soulTransferPolicyId: string
  makerRootId: string
  protocolConfigId: string
  outputRegistryId: string
  soulRegistryId: string
  paymentCoinType: string
  expectedNativeBinding: AnimacraftV8NativeBindingMetadata
}

export interface MintAnimacraftV8SoulTxParams extends MintPtbInputs {
  integration: AnimacraftV8NativeMintIntegration
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  name: string
  description: string
  attachBeforeMint?: (tx: Transaction) => void | Promise<void>
  /** Must produce the one-use V8 authorization in this same transaction. */
  createAuthorization: (tx: Transaction) => TransactionArgument | Promise<TransactionArgument>
}

function requireId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || /^0x0+$/.test(value)) {
    throw new Error(`${label} must be a canonical nonzero object ID`)
  }
}

function validateIntegration(value: AnimacraftV8NativeMintIntegration) {
  for (const key of [
    'soulidityCallablePackageId', 'soulidityOriginalPackageId', 'kioskPackageId',
    'marketConfigV2Id', 'kindRegistryId', 'kioskRegistryId', 'soulTransferPolicyId',
    'makerRootId', 'protocolConfigId', 'outputRegistryId', 'soulRegistryId',
  ] as const) requireId(value[key], key)
  const metadata = value.expectedNativeBinding
  if (!metadata) throw new Error('expectedNativeBinding is required')
  const expected = {
    soulOriginalType: `${value.soulidityOriginalPackageId}::soul::Soul`,
    mintWitnessOriginalType: `${value.soulidityOriginalPackageId}::animacraft_v8_binding::MintBindingWitnessV8`,
    ownerWitnessOriginalType: `${value.soulidityOriginalPackageId}::animacraft_v8_binding::SoulOwnerWitnessV8`,
  }
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (metadata[key] !== expected[key]) throw new Error(`expectedNativeBinding.${key} mismatch`)
  }
  // Soul may predate the proofs; both proofs must share their introduction release.
  const soulDefinition = metadata.soulDefiningType?.split('::')[0]
  const proofDefinition = metadata.mintWitnessDefiningType?.split('::')[0]
  requireId(soulDefinition, 'Soul defining package')
  requireId(proofDefinition, 'witness defining package')
  if (metadata.soulDefiningType !== `${soulDefinition}::soul::Soul`
    || metadata.mintWitnessDefiningType !== `${proofDefinition}::animacraft_v8_binding::MintBindingWitnessV8`
    || metadata.ownerWitnessDefiningType !== `${proofDefinition}::animacraft_v8_binding::SoulOwnerWitnessV8`) {
    throw new Error('expectedNativeBinding defining types mismatch')
  }
  if (typeof value.paymentCoinType !== 'string' || !value.paymentCoinType.includes('::')) {
    throw new Error('paymentCoinType must be an explicit Move struct type')
  }
  normalizeStructTag(value.paymentCoinType)
}

/**
 * Assemble the native V8 Complete boundary without legacy issuance or env defaults.
 * Caller must separately attest this deployment tuple and prove Complete living
 * content correspondence; local metadata checks do not certify either fact.
 */
export async function buildMintAnimacraftV8SoulTx(params: MintAnimacraftV8SoulTxParams): Promise<Transaction> {
  // Snapshot data before invoking either asynchronous hook.
  const identity = snapshotMintContentIdentity(params)
  const integration = structuredClone(params.integration)
  const initialContent = structuredClone(params.initialContent)
  const initialStateConfig = structuredClone(params.initialStateConfig)
  const { name, description, currentKioskId, currentKioskCapOnChainId,
    attachBeforeMint, createAuthorization } = params
  validateIntegration(integration)
  for (const [value, label, limit] of [
    [name, 'Soul name', MAX_NAME_BYTES], [description, 'Soul description', MAX_DESCRIPTION_BYTES],
  ] as const) {
    if (typeof value !== 'string' || (label === 'Soul name' && !value.trim())) throw new Error(`${label} is required`)
    if (getUtf8ByteLength(value) > limit) throw new Error(`${label} exceeds the ${limit}-byte limit`)
  }
  if (typeof createAuthorization !== 'function') throw new Error('createAuthorization is required')
  if (currentKioskId != null) requireId(currentKioskId, 'currentKioskId')
  if (currentKioskCapOnChainId != null) requireId(currentKioskCapOnChainId, 'currentKioskCapOnChainId')
  validateInitialContentEntries(initialContent)
  validateInitialStateConfigEntries(initialStateConfig)
  for (const entry of initialContent) requireId(entry.blobObjectId, 'initial content blobObjectId')
  const tx = new Transaction()
  const packageId = integration.soulidityCallablePackageId
  const kiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: currentKioskId, buyerKioskCapOnChainId: currentKioskCapOnChainId,
    runtime: {
      packageId, marketConfigId: integration.marketConfigV2Id,
      kioskRegistryId: integration.kioskRegistryId, kioskPackageId: integration.kioskPackageId,
    },
  })
  if (attachBeforeMint) await attachBeforeMint(tx)
  const authorizationStart = tx.getData().commands.length
  const authorization = await createAuthorization(tx)
  if (!authorization) throw new Error('createAuthorization did not return a V8 authorization')
  const result = authorization as { Result?: number; NestedResult?: [number, number] }
  const resultIndex = result.Result ?? result.NestedResult?.[0]
  if (resultIndex === undefined || !Number.isSafeInteger(resultIndex)
    || resultIndex < authorizationStart || !tx.getData().commands[resultIndex]?.MoveCall) {
    throw new Error('createAuthorization must return a Move-call result created in this transaction callback')
  }
  const { initialContentVec, initialStateConfigVec } = buildInitialContentArgs(tx, packageId,
    { initialContent, initialStateConfig }, integration.soulidityOriginalPackageId)
  const state = tx.moveCall({
    target: `${packageId}::market::mint_animacraft_v8_in_personal_kiosk`,
    typeArguments: [integration.paymentCoinType],
    arguments: [
      tx.object(integration.marketConfigV2Id), tx.object(integration.kindRegistryId),
      tx.object(integration.kioskRegistryId), tx.object(integration.soulTransferPolicyId),
      kiosk.buyerKiosk, kiosk.buyerKioskCap,
      tx.object(integration.makerRootId), tx.object(integration.protocolConfigId),
      tx.object(integration.outputRegistryId), tx.object(integration.soulRegistryId),
      authorization, tx.pure.string(name), tx.pure.string(description),
      initialContentVec, initialStateConfigVec, tx.pure.vector('u8', identity.mintNonce),
      tx.pure.id(identity.expectedContentObjectId), tx.object('0x6'),
    ],
  })
  appendFinalizeSoulState(tx, packageId, state)
  finishBuyerKioskArgs(tx, kiosk)
  return tx
}
