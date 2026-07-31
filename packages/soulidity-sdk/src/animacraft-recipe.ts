import { bcs } from '@mysten/sui/bcs'
import type {
  AnimacraftRecipeSlotInput,
  AnimacraftStyleSelectionV5Input,
} from './tx/animacraft'

const recipeSlotBcs = bcs.struct('RecipeSlot', {
  part_key: bcs.string(),
  item_key: bcs.string(),
  color_hex: bcs.string(),
  render_order: bcs.u64(),
})

const animacraftStyleSelectionV5Bcs = bcs.struct('StyleSelectionV5', {
  part_key: bcs.string(),
  item_key: bcs.string(),
  style_key: bcs.string(),
})

const completeSelectionHashInputV5Bcs = bcs.struct('CompleteSelectionHashInputV5', {
  recipe: bcs.vector(recipeSlotBcs),
  style_selections: bcs.vector(animacraftStyleSelectionV5Bcs),
})

export function animacraftRecipeBytes(
  recipe: ReadonlyArray<AnimacraftRecipeSlotInput>,
): Uint8Array {
  return bcs.vector(recipeSlotBcs).serialize(recipe.map((slot) => ({
    part_key: slot.partKey,
    item_key: slot.itemKey,
    color_hex: slot.colorHex,
    render_order: BigInt(slot.renderOrder),
  }))).toBytes()
}

export function animacraftCompleteSelectionBytesV5(
  recipe: ReadonlyArray<AnimacraftRecipeSlotInput>,
  styleSelections: ReadonlyArray<AnimacraftStyleSelectionV5Input>,
): Uint8Array {
  if (styleSelections.length !== recipe.length) {
    throw new Error('Every Animacraft v5 Recipe slot must have exactly one Style selection')
  }
  if (recipe.length === 0) {
    throw new Error('Animacraft v5 Recipe must contain at least one slot')
  }
  const normalizedRecipe = recipe.map((slot, index) => {
    if (!slot.partKey.trim() || !slot.itemKey.trim()) {
      throw new Error(`Animacraft v5 Recipe slot ${index + 1} is missing its Part or Item key`)
    }
    const renderOrder = BigInt(slot.renderOrder)
    if (renderOrder < 0n) {
      throw new Error(`Animacraft v5 Recipe slot ${index + 1} render order cannot be negative`)
    }
    return {
      part_key: slot.partKey,
      item_key: slot.itemKey,
      color_hex: slot.colorHex,
      render_order: renderOrder,
    }
  })
  const normalizedStyles = styleSelections.map((selection, index) => {
    if (
      !selection.partKey.trim()
      || !selection.itemKey.trim()
      || !selection.styleKey.trim()
    ) {
      throw new Error(`Animacraft Style selection ${index + 1} is incomplete`)
    }
    if (
      selection.partKey !== recipe[index]?.partKey
      || selection.itemKey !== recipe[index]?.itemKey
    ) {
      throw new Error(
        `Animacraft Style selection ${index + 1} does not match its Recipe Part and Item`,
      )
    }
    return {
      part_key: selection.partKey,
      item_key: selection.itemKey,
      style_key: selection.styleKey,
    }
  })
  return completeSelectionHashInputV5Bcs.serialize({
    recipe: normalizedRecipe,
    style_selections: normalizedStyles,
  }).toBytes()
}

export async function hashAnimacraftRecipe(
  recipe: ReadonlyArray<AnimacraftRecipeSlotInput>,
): Promise<Uint8Array> {
  const serialized = animacraftRecipeBytes(recipe)
  const digestInput = new Uint8Array(new ArrayBuffer(serialized.byteLength))
  digestInput.set(serialized)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput.buffer))
}

/** Exact browser-side mirror of `commerce_v5::hash_complete_selection_v5`. */
export async function hashAnimacraftCompleteSelectionV5(
  recipe: ReadonlyArray<AnimacraftRecipeSlotInput>,
  styleSelections: ReadonlyArray<AnimacraftStyleSelectionV5Input>,
): Promise<Uint8Array> {
  const serialized = animacraftCompleteSelectionBytesV5(recipe, styleSelections)
  const digestInput = new Uint8Array(new ArrayBuffer(serialized.byteLength))
  digestInput.set(serialized)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput.buffer))
}

export function parseAnimacraftRecipeHashHex(value: string): Uint8Array {
  const normalized = value.trim().replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('Animacraft recipe hash must be a 32-byte hexadecimal value')
  }
  return Uint8Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16))
}

export function equalAnimacraftRecipeHash(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}
