import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { evaluateNativeVisibility, nativeVisibilityCommitment } from '../../web/lib/animacraft/native-visibility'

type Selector = { source: number; source_key: string | null; part_key: string; item_key: string | null; style_key: string | null }
type Expression = { op: 'selected'; selector: Selector } | { op: 'not'; child: Expression }
  | { op: 'all' | 'any'; children: Expression[] }
type Selections = Parameters<typeof evaluateNativeVisibility>[1]
type Tokens = Parameters<typeof evaluateNativeVisibility>[0]
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`

// Independent recursive oracle: unlike the production postfix stack evaluator,
// this compares concrete source identities by name and evaluates an expression tree.
function oracle(expression: Expression, selections: Selections): boolean {
  if (expression.op === 'not') return !oracle(expression.child, selections)
  if (expression.op === 'all') return expression.children.every(child => oracle(child, selections))
  if (expression.op === 'any') return expression.children.some(child => oracle(child, selections))
  const selector = (expression as Extract<Expression, { op: 'selected' }>).selector
  const wantedSource = ['ANY', 'BASE', 'PACK', 'EXTERNAL'][selector.source]
  return selections.some(selection => {
    if (!selection) return false
    const observedSource = ['BASE', 'PACK', 'EXTERNAL'][selection.source_class]
    return (wantedSource === 'ANY' || wantedSource === observedSource)
      && (wantedSource !== 'PACK' || selector.source_key === selection.source_semantic_id)
      && (wantedSource !== 'EXTERNAL' || selector.source_key === selection.source_definition_id)
      && selector.part_key === selection.part_key
      && (selector.item_key === null || selector.item_key === selection.item_key)
      && (selector.style_key === null || selector.style_key === selection.style_key)
  })
}

function postfix(expression: Expression): Tokens {
  if (expression.op === 'selected') return [{ opcode: 0, arity: 0, selector: expression.selector }]
  if (expression.op === 'not') return [...postfix(expression.child), { opcode: 1, arity: 1, selector: null }]
  return [...expression.children.flatMap(postfix),
    { opcode: expression.op === 'all' ? 2 : 3, arity: expression.children.length, selector: null }]
}

it('matches an independent expression oracle across sparse exact-source identity truth tables', () => {
  const identities = [
    { source_class: 0, source_definition_id: id(10), source_semantic_id: '' },
    { source_class: 1, source_definition_id: id(20), source_semantic_id: 'pack-a' },
    { source_class: 1, source_definition_id: id(21), source_semantic_id: 'pack-b' },
    { source_class: 2, source_definition_id: id(30), source_semantic_id: '' },
    { source_class: 2, source_definition_id: id(31), source_semantic_id: '' },
  ]
  const concrete: Selections = identities.map((identity, index) => ({ ...identity,
    selection_index: String(index), part_key: 'body', item_key: 'hat', style_key: 'red',
    color_channel_key: null, swatch_key: null, layer_track_key: 'front', asset_blob_id: 'asset',
    asset_sha256: Array(32).fill(1), asset_content_commitment: Array(32).fill(2), access_subject: id(40 + index),
    source_epoch: '0', pricing_commitment: [], protected: false, seal_binding_commitment: [],
  }))
  const leaves: Expression[] = []
  for (const [source, source_key] of [[0, null], [1, null], [2, 'pack-a'], [2, 'pack-b'],
    [2, 'pack-missing'], [3, id(30)], [3, id(31)], [3, id(32)]] as const) {
    for (const path of [
      { part_key: 'body', item_key: null, style_key: null },
      { part_key: 'body', item_key: 'hat', style_key: null },
      { part_key: 'body', item_key: 'hat', style_key: 'red' },
      { part_key: 'body', item_key: 'hat', style_key: 'blue' },
      { part_key: 'other', item_key: null, style_key: null },
    ]) leaves.push({ op: 'selected', selector: { source, source_key, ...path } })
  }
  const expressions = leaves.flatMap((leaf, index): Expression[] => [leaf, { op: 'not', child: leaf },
    { op: 'all', children: [leaf, { op: 'not', child: leaves[(index + 7) % leaves.length] }] },
    { op: 'any', children: [{ op: 'all', children: [leaf, leaves[(index + 1) % leaves.length]] },
      { op: 'not', child: leaves[(index + 2) % leaves.length] }] },
  ])
  let compared = 0
  for (let mask = 0; mask < 1 << identities.length; mask++) {
    const selections = concrete.map((selection, index) => mask & 1 << index ? selection : null)
    const before = structuredClone(selections)
    expect(evaluateNativeVisibility([], selections)).toBe(true)
    for (const expression of expressions) {
      const tokens = postfix(expression), tokenBefore = structuredClone(tokens)
      expect(evaluateNativeVisibility(tokens, selections), JSON.stringify({ mask, expression }))
        .toBe(oracle(expression, selections))
      expect(tokens).toEqual(tokenBefore)
      compared++
    }
    expect(selections).toEqual(before)
  }
  expect(compared).toBe(5120)
})

it('binds every subject level and token column to independently encoded Core V1 BCS bytes', () => {
  // Manual BCS writer, independent of the production @mysten schema. Field order
  // follows Core VisibilityProgramCommitmentInputV1 (including u64 revision).
  const uleb = (value: number): number[] => value < 128 ? [value] : [(value & 127) | 128, ...uleb(value >>> 7)]
  const text = (value: string) => { const bytes = [...Buffer.from(value)]; return [...uleb(bytes.length), ...bytes] }
  const option = (value: string | null) => value === null ? [0] : [1, ...text(value)]
  const tokens: Tokens = [0, 1, 2, 3].map(source => ({ opcode: 0, arity: 0, selector: {
    source, source_key: source < 2 ? null : source === 2 ? 'pack-a' : id(30),
    part_key: '头部', item_key: source % 2 ? 'item' : null, style_key: source % 2 ? 'style' : null,
  } }))
  const program = [...tokens, { opcode: 3, arity: 4, selector: null }, { opcode: 1, arity: 1, selector: null }]
  const encodedToken = (token: Tokens[number]) => {
    const selector = token.selector
    return [token.opcode, ...(selector === null ? [0] : [1, selector.source, ...option(selector.source_key),
      ...text(selector.part_key), ...option(selector.item_key), ...option(selector.style_key)]),
    token.arity & 255, token.arity >>> 8]
  }
  const hashes = new Set<string>()
  for (const [level, name] of (['PART', 'ITEM', 'STYLE'] as const).entries()) {
    const subject = { level: name, partKey: '身体', itemKey: level >= 1 ? 'base' : null,
      styleKey: level === 2 ? 'blue' : null }
    for (const value of [[], program]) {
      const bytes = Buffer.from([...text('animacraft-fresh-v8/core/visibility-program/v1'),
        1, 0, 0, 0, 0, 0, 0, 0, 1, 0, level, ...text(subject.partKey),
        ...option(subject.itemKey), ...option(subject.styleKey), ...uleb(value.length), ...value.flatMap(encodedToken)])
      const expected = createHash('sha256').update(bytes).digest('hex')
      expect(Buffer.from(nativeVisibilityCommitment(subject, value)).toString('hex')).toBe(expected)
      hashes.add(expected)
    }
  }
  expect(hashes.size).toBe(6)
})

it('keeps Core depth/leaf/token bounds and validates even branches that would short-circuit', () => {
  const leaf = { opcode: 0, arity: 0, selector: { source: 1, source_key: null,
    part_key: 'body', item_key: null, style_key: null } }
  const not = { opcode: 1, selector: null, arity: 1 }
  const boundary = Array.from({ length: 32 }, () => [leaf, ...Array.from({ length: 6 }, () => not)]).flat()
  boundary.push({ opcode: 3, selector: null, arity: 32 })
  expect(boundary).toHaveLength(225)
  expect(evaluateNativeVisibility(boundary, [])).toBe(false)
  expect(evaluateNativeVisibility([leaf, { opcode: 2, selector: null, arity: 1 }], [])).toBe(false)
  expect(evaluateNativeVisibility([leaf, { opcode: 3, selector: null, arity: 1 }], [])).toBe(false)
  for (const invalid of [
    [...boundary, not],
    [...Array.from({ length: 33 }, () => leaf), { opcode: 3, selector: null, arity: 32 }],
    Array.from({ length: 289 }, () => not),
    [leaf, { opcode: 2, selector: null, arity: 0 }],
    [leaf, { opcode: 3, selector: null, arity: 2 }],
    [leaf, leaf],
    [leaf, not, { opcode: 4, selector: null, arity: 1 }, { opcode: 3, selector: null, arity: 2 }],
  ]) expect(() => evaluateNativeVisibility(invalid, [])).toThrow()
})
