import { bcs } from '@mysten/sui/bcs'
import { sha3_256 } from '@noble/hashes/sha3.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { toHex } from '@mysten/sui/utils'
import { ApplicationFormReferenceBcs } from './application-forms'
import { ManagementColorBcs, ManagementProfileSnapshotBcs, ManagementPartBcs, ManagementLayoutBcs,
  ManagementVariantBcs, ManagementProfileBcs, ManagementSceneBcs, ManagementAdapterBcs, ManagementScopeBcs, ManagementDesiredSlotBcs } from './application-bcs'
import { ManagementSlotSnapshotBcs } from './application-recipe'

const A = bcs.Address, U = bcs.u64(), V = bcs.byteVector()
const fields = { root: A, application: A, reference: ApplicationFormReferenceBcs, parent: bcs.option(ApplicationFormReferenceBcs), creator: A, epoch: U,
  application_revision: U, composition_revision: U, scene: V, colors: bcs.vector(ManagementColorBcs), profiles: bcs.vector(ManagementProfileSnapshotBcs) }
export const ApplicationFormSnapshotBcs = bcs.struct('Snapshot', { id: A, schema: bcs.u16(), ...fields, recipe: V, render: V, commitment: V })
export const ApplicationFormSnapshotCommitmentBcs = bcs.struct('SnapshotCommitment', { domain: V, schema: bcs.u16(), ...fields,
  selections: V, sources: V, recipe: V, render: V })
const VisualCommitment = bcs.struct('VisualSnapshotCommitment', { domain: V, base: ApplicationFormSnapshotCommitmentBcs, variants: bcs.vector(V) })
const VariantCommitment = bcs.struct('VariantCommitment', { domain: V, schema: bcs.u16(), original: ManagementProfileBcs,
  target: ManagementSceneBcs, adapters: bcs.vector(ManagementAdapterBcs) })
export const ApplicationFormSelectionsBcs = bcs.vector(ManagementDesiredSlotBcs)
export const ApplicationFormSourcesBcs = bcs.vector(ManagementSlotSnapshotBcs)
function check(value: unknown, code: string): asserts value { if (!value) throw Error(`APPLICATION_FORM_SNAPSHOT_${code}`) }
const text = (s: string) => new TextEncoder().encode(s)
const hex = (bytes: Iterable<number>) => toHex(Uint8Array.from(bytes))

/** Verify immutable Forms metadata against its recorded commitment. This proves
 * captured data integrity, not current Item custody, renderer or apply authority.
 * The recipe is a semantic output hash, distinct from Application.recipe_hash. */
export function verifyApplicationFormSnapshot(input: {
  snapshot: ReturnType<typeof ApplicationFormSnapshotBcs.parse>; selections: ReturnType<typeof ApplicationFormSelectionsBcs.parse>
  sources: ReturnType<typeof ApplicationFormSourcesBcs.parse>; variants: ReturnType<typeof ManagementVariantBcs.parse>[]
  expected: { root: string; application: string; snapshot: string; reference: ReturnType<typeof ApplicationFormReferenceBcs.parse>; commitment: string }
}) {
  const { snapshot: s, selections, sources, variants, expected } = structuredClone(input)
  check(s.id === expected.snapshot && s.root === expected.root && s.application === expected.application
    && ApplicationFormReferenceBcs.serialize(s.reference).toBase64() === ApplicationFormReferenceBcs.serialize(expected.reference).toBase64()
    && hex(s.commitment) === expected.commitment && s.scene.length === 32 && s.recipe.length === 32 && s.render.length === 32, 'BINDING')
  check(selections.length <= 512 && selections.length === sources.length && s.profiles.length <= 64 && variants.length <= 65, 'BOUNDS')
  const parts = new Set<string>()
  for (let i = 0; i < selections.length; i++) {
    const selected = selections[i], source = sources[i], key = ManagementPartBcs.serialize(selected.part).toBase64()
    check(!parts.has(key) && key === ManagementPartBcs.serialize(source.part).toBase64(), 'PARTS'); parts.add(key)
    const binding = source.binding, choice = selected.selection
    if (choice.$kind === 'Empty') check(binding === null, 'EMPTY')
    else {
      const layout = choice.Free?.layout ?? choice.Bound?.layout ?? choice.Reference?.layout
      check(binding && layout && ManagementLayoutBcs.serialize(binding.layout).toBase64() === ManagementLayoutBcs.serialize(layout).toBase64(), 'LAYOUT')
      check(binding.source.source_hash.length === 32 && binding.source.definition.length === 32 && binding.source.representation.length === 32
        && (binding.adapter === null || binding.adapter.length === 32), 'SOURCE_HASH')
      if (choice.$kind === 'Free') check(binding.source.rights === 2 && binding.item === choice.Free.id && binding.bound === null, 'FREE')
      else if (choice.$kind === 'Bound') check(binding.source.rights === 1 && binding.bound === choice.Bound.index && binding.item === null, 'BOUND')
      else check(binding.source.rights === 0 && binding.bound === null && binding.item === null, 'REFERENCE')
    }
  }
  const scopes = new Set<string>()
  for (const variant of variants) {
    const key = ManagementScopeBcs.serialize(variant.original.scope).toBase64()
    check(!scopes.has(key) && hex(variant.domain) === hex(text('soulidity/visual-variant/v1')) && variant.schema === 1
      && hex(variant.target_hash) === hex(sha256(ManagementSceneBcs.serialize(variant.target).toBytes()))
      && hex(variant.commitment) === hex(sha256(VariantCommitment.serialize(variant).toBytes())), 'VARIANT'); scopes.add(key)
  }
  const base = { ...s, domain: text('soulidity/oc-form/v1'), schema: 1,
    selections: sha3_256(ApplicationFormSelectionsBcs.serialize(selections).toBytes()), sources: sha3_256(ApplicationFormSourcesBcs.serialize(sources).toBytes()) }
  // schema is fixed at1 in the nested base, even for visual snapshot schema2.
  base.schema = 1
  const sorted = [...variants].sort((a, b) => {
    const aa = ManagementScopeBcs.serialize(a.original.scope).toBytes(), bb = ManagementScopeBcs.serialize(b.original.scope).toBytes()
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i]
    return aa.length - bb.length
  })
  check((s.schema === 1 && !variants.length) || (s.schema === 2 && variants.length > 0), 'SCHEMA')
  const bytes = s.schema === 1 ? ApplicationFormSnapshotCommitmentBcs.serialize(base).toBytes()
    : VisualCommitment.serialize({ domain: text('soulidity/oc-form/v2'), base, variants: sorted.map(v => v.commitment) }).toBytes()
  check(hex(sha3_256(bytes)) === expected.commitment, 'COMMITMENT')
  return { snapshot: s, selections, sources, variants, commitmentVerified: true as const, recipeQualified: false as const,
    equipmentAvailability: 'NOT_CHECKED' as const, applyQualified: false as const }
}
