import {
  Transaction,
  type TransactionArgument,
  type TransactionObjectArgument,
} from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { hashAnimacraftCompleteSelectionV5 } from '../animacraft-recipe'
import {
  SOULIDITY_WARDROBE_ADAPTER_V7_MODULE,
  assertPhysicalWardrobeV7Runtime,
  type PhysicalWardrobeV7MakerContext,
  type PhysicalWardrobeV7Runtime,
  type PhysicalWardrobeV7SoulContext,
} from '../physical-wardrobe-v7'

export const PHYSICAL_WARDROBE_V7_ADAPTER_TARGETS = {
  create: 'create_soul_wardrobe_v7',
  claimInitial: 'claim_initial_included_style_v7',
  finalize: 'finalize_soul_wardrobe_v7',
  depositAndEquip: 'deposit_and_equip_style_v7',
  depositAndSwap: 'deposit_and_swap_style_v7',
  equip: 'equip_style_v7',
  swap: 'swap_style_v7',
  unequip: 'unequip_style_v7',
  withdraw: 'withdraw_style_v7',
  emergencyWithdraw: 'emergency_unequip_and_withdraw_style_v7',
} as const

export const PHYSICAL_WARDROBE_V7_DIRECT_TARGETS = {
  beginInitial: 'begin_initial_physical_loadout_authorization_v7',
  appendInitialStyle: 'append_initial_style_to_authorization_v7',
  appendInitialLogical: 'append_initial_logical_style_to_authorization_v7',
  sealInitial: 'seal_initial_physical_loadout_authorization_v7',
  transferOwned: 'transfer_owned_style_v7',
} as const

function requireId(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required`)
  try { return normalizeSuiAddress(trimmed) } catch { throw new Error(`${label} is invalid`) }
}

function requireU64(value: number | bigint, label: string): bigint {
  let result: bigint
  try {
    result = BigInt(value)
  } catch {
    throw new Error(`${label} is not a valid u64`)
  }
  if (result < 0n || result > ((1n << 64n) - 1n)) {
    throw new Error(`${label} is outside the u64 range`)
  }
  return result
}

function requireRevision(value: number | bigint): bigint {
  return requireU64(value, 'expectedRevision')
}

function adapterTarget(
  runtime: PhysicalWardrobeV7Runtime,
  name: (typeof PHYSICAL_WARDROBE_V7_ADAPTER_TARGETS)[keyof typeof PHYSICAL_WARDROBE_V7_ADAPTER_TARGETS],
): `${string}::${string}::${string}` {
  assertPhysicalWardrobeV7Runtime(runtime)
  return `${runtime.soulidityCallablePackageId}::${SOULIDITY_WARDROBE_ADAPTER_V7_MODULE}::${name}`
}

function animacraftPhysicalTarget(
  runtime: PhysicalWardrobeV7Runtime,
  name: (typeof PHYSICAL_WARDROBE_V7_DIRECT_TARGETS)[keyof typeof PHYSICAL_WARDROBE_V7_DIRECT_TARGETS],
): `${string}::physical_composition_v7::${string}` {
  assertPhysicalWardrobeV7Runtime(runtime)
  return `${runtime.animacraftCallablePackageId}::physical_composition_v7::${name}`
}

function validateMaker(context: PhysicalWardrobeV7MakerContext): void {
  requireId(context.physicalProfileObjectId, 'physicalProfileObjectId')
  requireId(context.compositionProfileObjectId, 'compositionProfileObjectId')
  requireId(context.makerRootObjectId, 'makerRootObjectId')
}

function validateSoul(context: PhysicalWardrobeV7SoulContext): void {
  requireId(context.soulObjectId, 'soulObjectId')
  requireId(context.soulStateObjectId, 'soulStateObjectId')
  requireId(context.wardrobeObjectId, 'wardrobeObjectId')
  requireRevision(context.expectedRevision)
}

function makerArguments(
  tx: Transaction,
  runtime: PhysicalWardrobeV7Runtime,
  maker: PhysicalWardrobeV7MakerContext,
) {
  assertPhysicalWardrobeV7Runtime(runtime)
  validateMaker(maker)
  return [
    tx.object(runtime.physicalProtocolConfigObjectId),
    tx.object(runtime.compositionProtocolConfigObjectId),
    tx.object(maker.physicalProfileObjectId),
    tx.object(maker.compositionProfileObjectId),
    tx.object(maker.makerRootObjectId),
    tx.object(runtime.commerceProtocolConfigObjectId),
  ] as const
}

export interface CreatePhysicalSoulWardrobeV7TxParams {
  runtime: PhysicalWardrobeV7Runtime
  maker: PhysicalWardrobeV7MakerContext
  soulStateObjectId: string
  recipe: readonly PhysicalInitialRecipeSlotV7[]
  styleSelections: readonly PhysicalInitialStyleSelectionV7[]
  initialRows: readonly PhysicalInitialAuthorizationRowV7[]
}

export interface PhysicalInitialRecipeSlotV7 {
  partKey: string
  itemKey: string
  colorHex: string
  renderOrder: number | bigint
}

export interface PhysicalInitialStyleSelectionV7 {
  partKey: string
  itemKey: string
  styleKey: string
}

export type PhysicalInitialAuthorizationRowV7 =
  | {
      kind: 'visual'
      familyObjectId: string
      styleProductObjectId: string
    }
  | {
      kind: 'logical'
    }

export interface TransferOwnedPhysicalStyleV7TxParams {
  runtime: PhysicalWardrobeV7Runtime
  styleAssetObjectId: string
  recipient: string
}

/**
 * Recovery-safe wallet-to-wallet gift of one unbound Owned Style.
 *
 * Move re-checks that the signer is the recorded holder, the Style is not in
 * Soul custody, and the Product is transferable. This intentionally performs
 * no payment or royalty settlement and must not be used as a marketplace path.
 */
export function buildTransferOwnedPhysicalStyleV7Tx(
  params: TransferOwnedPhysicalStyleV7TxParams,
): Transaction {
  const styleAssetObjectId = requireId(params.styleAssetObjectId, 'styleAssetObjectId')
  const recipient = requireId(params.recipient, 'recipient')
  if (recipient === normalizeSuiAddress('0x0')) {
    throw new Error('recipient cannot be the zero address')
  }
  const tx = new Transaction()
  tx.moveCall({
    target: animacraftPhysicalTarget(
      params.runtime,
      PHYSICAL_WARDROBE_V7_DIRECT_TARGETS.transferOwned,
    ),
    arguments: [
      tx.object(styleAssetObjectId),
      tx.pure.address(recipient),
    ],
  })
  return tx
}

export interface PhysicalWardrobeV7MintContext {
  runtime: PhysicalWardrobeV7Runtime
  maker: PhysicalWardrobeV7MakerContext
  recipe: readonly PhysicalInitialRecipeSlotV7[]
  styleSelections: readonly PhysicalInitialStyleSelectionV7[]
  /** One row for every canonical v5 Recipe index, in exact order. */
  initialRows: readonly PhysicalInitialAuthorizationRowV7[]
}

export interface AppendPhysicalSoulWardrobeV7Params extends PhysicalWardrobeV7MintContext {
  soulState: TransactionArgument
}

/**
 * Atomically create, bind, populate and finalize a wardrobe around a live
 * SoulState value. The unshared key-only wardrobe cannot escape this PTB.
 */
export async function appendPhysicalSoulWardrobeV7(
  tx: Transaction,
  params: AppendPhysicalSoulWardrobeV7Params,
): Promise<void> {
  assertPhysicalWardrobeV7Runtime(params.runtime)
  validateMaker(params.maker)
  if (
    params.recipe.length === 0
    || params.styleSelections.length !== params.recipe.length
    || params.initialRows.length !== params.recipe.length
  ) {
    throw new Error('Physical Wardrobe v7 authorization must cover every v5 Recipe row')
  }
  const visualRows = params.initialRows.filter((row) => row.kind === 'visual')
  if (visualRows.length === 0) {
    throw new Error('Physical Wardrobe v7 requires at least one initial Included Style')
  }
  const visualProductIds = visualRows.map((row, index) => {
    requireId(row.familyObjectId, `initialRows[${index}].familyObjectId`)
    return requireId(row.styleProductObjectId, `initialRows[${index}].styleProductObjectId`)
  })
  if (new Set(visualProductIds).size !== visualProductIds.length) {
    throw new Error('Physical Wardrobe v7 initial Style products contain duplicates')
  }
  const recipeHash = await hashAnimacraftCompleteSelectionV5(
    params.recipe,
    params.styleSelections,
  )
  const recipeElements = params.recipe.map((slot, index) => {
    if (!slot.partKey.trim() || !slot.itemKey.trim() || !slot.colorHex.trim()) {
      throw new Error(`Physical Wardrobe v7 Recipe row ${index + 1} is incomplete`)
    }
    return tx.moveCall({
      target: `${params.runtime.animacraftCallablePackageId}::animacraft::new_recipe_slot`,
      arguments: [
        tx.pure.string(slot.partKey),
        tx.pure.string(slot.itemKey),
        tx.pure.string(slot.colorHex),
      tx.pure.u64(requireU64(slot.renderOrder, `recipe[${index}].renderOrder`)),
      ],
    }) as unknown as TransactionObjectArgument
  })
  const recipe = tx.makeMoveVec({
    type: `${params.runtime.animacraftTypeOriginPackageId}::animacraft::RecipeSlot`,
    elements: recipeElements,
  })
  const initialAuthorization = tx.moveCall({
    target: animacraftPhysicalTarget(
      params.runtime,
      PHYSICAL_WARDROBE_V7_DIRECT_TARGETS.beginInitial,
    ),
    arguments: [
      tx.object(params.runtime.physicalProtocolConfigObjectId),
      tx.object(params.maker.physicalProfileObjectId),
      tx.object(params.maker.makerRootObjectId),
      tx.pure.vector('u8', Array.from(recipeHash)),
      recipe,
    ],
  })
  params.initialRows.forEach((row, index) => {
    const selection = params.styleSelections[index]
    if (!selection?.styleKey.trim()) {
      throw new Error(`Physical Wardrobe v7 Style selection ${index + 1} is incomplete`)
    }
    if (row.kind === 'visual') {
      tx.moveCall({
        target: animacraftPhysicalTarget(
          params.runtime,
          PHYSICAL_WARDROBE_V7_DIRECT_TARGETS.appendInitialStyle,
        ),
        arguments: [
          initialAuthorization,
          tx.object(params.maker.makerRootObjectId),
          tx.object(row.familyObjectId),
          tx.object(row.styleProductObjectId),
        ],
      })
    } else {
      tx.moveCall({
        target: animacraftPhysicalTarget(
          params.runtime,
          PHYSICAL_WARDROBE_V7_DIRECT_TARGETS.appendInitialLogical,
        ),
        arguments: [
          initialAuthorization,
          tx.object(params.maker.makerRootObjectId),
          tx.pure.string(selection.styleKey),
        ],
      })
    }
  })
  tx.moveCall({
    target: animacraftPhysicalTarget(
      params.runtime,
      PHYSICAL_WARDROBE_V7_DIRECT_TARGETS.sealInitial,
    ),
    arguments: [initialAuthorization],
  })

  const wardrobe = tx.moveCall({
    target: adapterTarget(params.runtime, PHYSICAL_WARDROBE_V7_ADAPTER_TARGETS.create),
    arguments: [
      tx.object(params.runtime.physicalRegistryObjectId),
      ...makerArguments(tx, params.runtime, params.maker),
      initialAuthorization,
      params.soulState,
    ],
  })
  visualRows.forEach((row, index) => {
    tx.moveCall({
      target: adapterTarget(params.runtime, PHYSICAL_WARDROBE_V7_ADAPTER_TARGETS.claimInitial),
      arguments: [
        wardrobe,
        tx.object(params.runtime.physicalProtocolConfigObjectId),
        tx.object(params.maker.physicalProfileObjectId),
        tx.object(params.maker.compositionProfileObjectId),
        tx.object(row.styleProductObjectId),
        params.soulState,
        tx.pure.u64(BigInt(index)),
      ],
    })
  })
  tx.moveCall({
    target: adapterTarget(params.runtime, PHYSICAL_WARDROBE_V7_ADAPTER_TARGETS.finalize),
    arguments: [
      wardrobe,
      tx.object(params.runtime.physicalProtocolConfigObjectId),
      tx.object(params.maker.physicalProfileObjectId),
      params.soulState,
      tx.pure.u64(BigInt(visualRows.length)),
    ],
  })
}

/** Resume creation only for a SoulState minted through the trusted v7 boundary. */
export async function buildCreatePhysicalSoulWardrobeV7Tx(
  params: CreatePhysicalSoulWardrobeV7TxParams,
): Promise<Transaction> {
  requireId(params.soulStateObjectId, 'soulStateObjectId')
  const tx = new Transaction()
  await appendPhysicalSoulWardrobeV7(tx, {
    runtime: params.runtime,
    maker: params.maker,
    soulState: tx.object(params.soulStateObjectId),
    recipe: params.recipe,
    styleSelections: params.styleSelections,
    initialRows: params.initialRows,
  })
  return tx
}

interface PhysicalWardrobeMutationV7TxParams {
  runtime: PhysicalWardrobeV7Runtime
  maker: PhysicalWardrobeV7MakerContext
  soul: PhysicalWardrobeV7SoulContext
}

interface PhysicalStyleProductV7TxParams extends PhysicalWardrobeMutationV7TxParams {
  styleProductObjectId: string
}

function mutationArguments(
  tx: Transaction,
  params: PhysicalWardrobeMutationV7TxParams,
) {
  validateSoul(params.soul)
  return [
    tx.object(params.soul.wardrobeObjectId),
    ...makerArguments(tx, params.runtime, params.maker),
    tx.object(params.soul.soulStateObjectId),
  ] as const
}

export interface DepositAndEquipPhysicalStyleV7TxParams extends PhysicalStyleProductV7TxParams {
  walletStyleAssetObjectId: string
}

/**
 * Atomically move a wallet Style into Soul custody and equip it into its
 * canonical Part slot. The Move adapter derives Soul/owner from SoulState;
 * callers cannot substitute either field.
 */
export function buildDepositAndEquipPhysicalStyleV7Tx(
  params: DepositAndEquipPhysicalStyleV7TxParams,
): Transaction {
  requireId(params.styleProductObjectId, 'styleProductObjectId')
  requireId(params.walletStyleAssetObjectId, 'walletStyleAssetObjectId')
  const tx = new Transaction()
  tx.moveCall({
    target: adapterTarget(params.runtime, PHYSICAL_WARDROBE_V7_ADAPTER_TARGETS.depositAndEquip),
    arguments: [
      ...mutationArguments(tx, params),
      tx.object(params.styleProductObjectId),
      tx.object(params.walletStyleAssetObjectId),
      tx.pure.u64(requireRevision(params.soul.expectedRevision)),
    ],
  })
  return tx
}

export interface DepositAndSwapPhysicalStyleV7TxParams extends DepositAndEquipPhysicalStyleV7TxParams {
  equippedStyleAssetObjectId: string
}

/** Deposit a new wallet Style and replace the existing child in one PTB. */
export function buildDepositAndSwapPhysicalStyleV7Tx(
  params: DepositAndSwapPhysicalStyleV7TxParams,
): Transaction {
  requireId(params.styleProductObjectId, 'styleProductObjectId')
  requireId(params.walletStyleAssetObjectId, 'walletStyleAssetObjectId')
  requireId(params.equippedStyleAssetObjectId, 'equippedStyleAssetObjectId')
  const tx = new Transaction()
  tx.moveCall({
    target: adapterTarget(params.runtime, PHYSICAL_WARDROBE_V7_ADAPTER_TARGETS.depositAndSwap),
    arguments: [
      ...mutationArguments(tx, params),
      tx.object(params.styleProductObjectId),
      tx.object(params.walletStyleAssetObjectId),
      tx.object(params.equippedStyleAssetObjectId),
      tx.pure.u64(requireRevision(params.soul.expectedRevision)),
    ],
  })
  return tx
}

export interface EquipPhysicalStyleV7TxParams extends PhysicalStyleProductV7TxParams {
  wardrobeStyleAssetObjectId: string
}

export function buildEquipPhysicalStyleV7Tx(params: EquipPhysicalStyleV7TxParams): Transaction {
  requireId(params.styleProductObjectId, 'styleProductObjectId')
  requireId(params.wardrobeStyleAssetObjectId, 'wardrobeStyleAssetObjectId')
  const tx = new Transaction()
  tx.moveCall({
    target: adapterTarget(params.runtime, PHYSICAL_WARDROBE_V7_ADAPTER_TARGETS.equip),
    arguments: [
      ...mutationArguments(tx, params),
      tx.object(params.styleProductObjectId),
      tx.object(params.wardrobeStyleAssetObjectId),
      tx.pure.u64(requireRevision(params.soul.expectedRevision)),
    ],
  })
  return tx
}

export interface SwapPhysicalStyleV7TxParams extends PhysicalStyleProductV7TxParams {
  wardrobeStyleAssetObjectId: string
  equippedStyleAssetObjectId: string
}

/** Replace one wardrobe-owned child with another without leaving Soul custody. */
export function buildSwapPhysicalStyleV7Tx(params: SwapPhysicalStyleV7TxParams): Transaction {
  requireId(params.styleProductObjectId, 'styleProductObjectId')
  requireId(params.wardrobeStyleAssetObjectId, 'wardrobeStyleAssetObjectId')
  requireId(params.equippedStyleAssetObjectId, 'equippedStyleAssetObjectId')
  const tx = new Transaction()
  tx.moveCall({
    target: adapterTarget(params.runtime, PHYSICAL_WARDROBE_V7_ADAPTER_TARGETS.swap),
    arguments: [
      ...mutationArguments(tx, params),
      tx.object(params.styleProductObjectId),
      tx.object(params.wardrobeStyleAssetObjectId),
      tx.object(params.equippedStyleAssetObjectId),
      tx.pure.u64(requireRevision(params.soul.expectedRevision)),
    ],
  })
  return tx
}

export interface UnequipPhysicalStyleV7TxParams extends PhysicalWardrobeMutationV7TxParams {
  equippedStyleAssetObjectId: string
}

export function buildUnequipPhysicalStyleV7Tx(params: UnequipPhysicalStyleV7TxParams): Transaction {
  requireId(params.equippedStyleAssetObjectId, 'equippedStyleAssetObjectId')
  const tx = new Transaction()
  tx.moveCall({
    target: adapterTarget(params.runtime, PHYSICAL_WARDROBE_V7_ADAPTER_TARGETS.unequip),
    arguments: [
      ...mutationArguments(tx, params),
      tx.object(params.equippedStyleAssetObjectId),
      tx.pure.u64(requireRevision(params.soul.expectedRevision)),
    ],
  })
  return tx
}

export interface WithdrawPhysicalStyleV7TxParams extends PhysicalWardrobeMutationV7TxParams {
  wardrobeStyleAssetObjectId: string
}

/**
 * Return an external Style to the wallet. Animacraft's withdrawal path must
 * intentionally ignore Maker pause/archive gates; Soulidity still requires
 * the live owner and a delisted Soul.
 */
export function buildWithdrawPhysicalStyleV7Tx(params: WithdrawPhysicalStyleV7TxParams): Transaction {
  requireId(params.wardrobeStyleAssetObjectId, 'wardrobeStyleAssetObjectId')
  validateSoul(params.soul)
  assertPhysicalWardrobeV7Runtime(params.runtime)
  const tx = new Transaction()
  tx.moveCall({
    target: adapterTarget(params.runtime, PHYSICAL_WARDROBE_V7_ADAPTER_TARGETS.withdraw),
    arguments: [
      tx.object(params.soul.wardrobeObjectId),
      tx.object(params.runtime.physicalProtocolConfigObjectId),
      tx.object(params.soul.soulStateObjectId),
      tx.object(params.wardrobeStyleAssetObjectId),
      tx.pure.u64(requireRevision(params.soul.expectedRevision)),
    ],
  })
  return tx
}

export interface EmergencyWithdrawPhysicalStyleV7TxParams
  extends PhysicalWardrobeMutationV7TxParams {
  equippedStyleAssetObjectId: string
}

/** Recover an equipped external Style even while publication gates are paused. */
export function buildEmergencyWithdrawPhysicalStyleV7Tx(
  params: EmergencyWithdrawPhysicalStyleV7TxParams,
): Transaction {
  requireId(params.equippedStyleAssetObjectId, 'equippedStyleAssetObjectId')
  validateSoul(params.soul)
  assertPhysicalWardrobeV7Runtime(params.runtime)
  const tx = new Transaction()
  tx.moveCall({
    target: adapterTarget(
      params.runtime,
      PHYSICAL_WARDROBE_V7_ADAPTER_TARGETS.emergencyWithdraw,
    ),
    arguments: [
      tx.object(params.soul.wardrobeObjectId),
      tx.object(params.runtime.physicalProtocolConfigObjectId),
      tx.object(params.soul.soulStateObjectId),
      tx.object(params.equippedStyleAssetObjectId),
      tx.pure.u64(requireRevision(params.soul.expectedRevision)),
    ],
  })
  return tx
}
