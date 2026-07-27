import { bcs } from '@mysten/sui/bcs'
import type { AnimacraftRecipeSlotInput } from './tx/animacraft'

const recipeSlotBcs = bcs.struct('RecipeSlot', {
  part_key: bcs.string(),
  item_key: bcs.string(),
  color_hex: bcs.string(),
  render_order: bcs.u64(),
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

export async function hashAnimacraftRecipe(
  recipe: ReadonlyArray<AnimacraftRecipeSlotInput>,
): Promise<Uint8Array> {
  const serialized = animacraftRecipeBytes(recipe)
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
