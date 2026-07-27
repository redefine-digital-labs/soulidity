import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'
import { getKioskPackageAddress } from '../kiosk'
import {
  appendFinalizeSoulState,
  buildInitialContentArgs,
  type MintPtbInputs,
} from './mint-helpers'
import {
  buildBuyerKioskArgs,
  finishBuyerKioskArgs,
  validateInitialContentEntries,
  validateInitialStateConfigEntries,
  validateSoulPublishArgs,
} from './shared'

const SUI_CLOCK_OBJECT_ID = '0x6'

export interface PersonalJoinTxParams extends MintPtbInputs {
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  attachBeforeMint?: (tx: Transaction) => void | Promise<void>
  /** ID of the Object<T> that is being joined (kiosk-locked under T's TransferPolicy). */
  sourceObjectId: string
  /** Fully-qualified Move type of the source object, e.g. `0xabc::module::Type`. */
  sourceObjectType: string
  name: string
  description: string
  imageUrl: string
  originRef: string
  creatorRoyaltyBps: number
}

/**
 * Build the Personal Join PTB: place an existing kiosk-held Object<T> into
 * the buyer's personal kiosk, then call `mint_joined_in_personal_kiosk<T>`
 * which records the source object id in `KioskRegistry` and consumes it as
 * provenance for the new Soul.
 */
export async function buildPersonalJoinSoulTx(params: PersonalJoinTxParams): Promise<Transaction> {
  validateSoulPublishArgs(params)
  validateInitialContentEntries(params.initialContent)
  validateInitialStateConfigEntries(params.initialStateConfig)
  if (params.originRef.trim().length === 0) {
    throw new Error('originRef is required for Personal Join')
  }
  if (params.sourceObjectType.trim().length === 0) {
    throw new Error('sourceObjectType is required for Personal Join')
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')
  const kindRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const transferPolicyId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID')
  const tx = new Transaction()
  const personalKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.currentKioskId,
    buyerKioskCapOnChainId: params.currentKioskCapOnChainId,
  })

  // Place the source object into the buyer's personal kiosk by borrowing the
  // owner cap, calling `kiosk::place<T>`, and returning the cap.
  const kioskPackageId = getKioskPackageAddress()
  const [kioskOwnerCap, borrowHotPotato] = tx.moveCall({
    target: `${kioskPackageId}::personal_kiosk::borrow_val`,
    arguments: [personalKiosk.buyerKioskCap],
  })
  tx.moveCall({
    target: '0x2::kiosk::place',
    typeArguments: [params.sourceObjectType],
    arguments: [
      personalKiosk.buyerKiosk,
      kioskOwnerCap,
      tx.object(params.sourceObjectId),
    ],
  })
  tx.moveCall({
    target: `${kioskPackageId}::personal_kiosk::return_val`,
    arguments: [personalKiosk.buyerKioskCap, kioskOwnerCap, borrowHotPotato],
  })

  if (params.attachBeforeMint) {
    await params.attachBeforeMint(tx)
  }

  const { initialContentVec, initialStateConfigVec } = buildInitialContentArgs(tx, packageId, {
    initialContent: params.initialContent,
    initialStateConfig: params.initialStateConfig,
  })

  const soulState = tx.moveCall({
    target: `${packageId}::market::mint_joined_in_personal_kiosk_v2`,
    typeArguments: [params.sourceObjectType],
    arguments: [
      tx.object(marketConfigId),
      tx.object(kindRegistryId),
      tx.object(kioskRegistryId),
      tx.object(transferPolicyId),
      personalKiosk.buyerKiosk,
      personalKiosk.buyerKioskCap,
      tx.pure.id(params.sourceObjectId),
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
