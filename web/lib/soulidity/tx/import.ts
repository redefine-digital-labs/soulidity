import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import {
  appendFinalizeSoulState,
  buildInitialContentArgs,
  type MintPtbInputs,
} from '@/lib/soulidity/tx/mint-helpers'
import {
  buildBuyerKioskArgs,
  finishBuyerKioskArgs,
  validateInitialContentEntries,
  validateInitialStateConfigEntries,
  validateSoulPublishArgs,
} from '@/lib/soulidity/tx/shared'

const SUI_CLOCK_OBJECT_ID = '0x6'

export interface ImportSoulTxParams extends MintPtbInputs {
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  name: string
  description: string
  imageUrl: string
  /**
   * Free-form, off-chain claim about where this Soul came from. The chain
   * does not verify this string; UI must label imported Souls as such per
   * `mint_imported_in_personal_kiosk` doc-comments.
   */
  originRef: string
  creatorRoyaltyBps: number
}

/**
 * Build a `mint_imported_in_personal_kiosk` PTB. Origin string is stored
 * as the unverified `Soul.origin_ref` Option<String>.
 */
export function buildImportSoulTx(params: ImportSoulTxParams): Transaction {
  validateSoulPublishArgs(params)
  validateInitialContentEntries(params.initialContent)
  validateInitialStateConfigEntries(params.initialStateConfig)
  if (params.originRef.trim().length === 0) {
    throw new Error('originRef is required for imported Souls')
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
  const kindRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const transferPolicyId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID')
  const tx = new Transaction()
  const personalKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.currentKioskId,
    buyerKioskCapOnChainId: params.currentKioskCapOnChainId,
  })

  const { initialContentVec, initialStateConfigVec } = buildInitialContentArgs(tx, packageId, {
    initialContent: params.initialContent,
    initialStateConfig: params.initialStateConfig,
  })

  const soulState = tx.moveCall({
    target: `${packageId}::market::mint_imported_in_personal_kiosk`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kindRegistryId),
      tx.object(kioskRegistryId),
      tx.object(transferPolicyId),
      personalKiosk.buyerKiosk,
      personalKiosk.buyerKioskCap,
      tx.pure.string(params.name),
      tx.pure.string(params.description),
      tx.pure.string(params.imageUrl),
      initialContentVec,
      initialStateConfigVec,
      tx.pure.string(params.originRef),
      tx.pure.u16(params.creatorRoyaltyBps),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })

  appendFinalizeSoulState(tx, packageId, soulState)
  finishBuyerKioskArgs(tx, personalKiosk)
  return tx
}
