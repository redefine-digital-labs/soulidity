import { toHex } from '@mysten/sui/utils'
import { ManagementSceneBcs } from './application-bcs'
type Scene = ReturnType<typeof ManagementSceneBcs.parse>
type Selector = Scene['rules'][number]['trigger']
type Token = Scene['anchors'][number]['when'][number]
export interface ManagementVisualFact { product: string; version: string; part: Uint8Array; item: Uint8Array; style: Uint8Array }
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`APPLICATION_VISUAL_RULE_${code}`) }
function key(value: Uint8Array) { check(value.length > 0 && value.length <= 64, 'KEY') }
function selector(value: Selector) {
  key(value.part); check((value.product === null) === (value.version === null) && (value.style === null || value.item !== null), 'SELECTOR')
  if (value.product !== null) check(/^0x[0-9a-f]{64}$/.test(value.product) && !/^0x0+$/.test(value.product) && BigInt(value.version!) > 0n, 'SELECTOR')
  if (value.item !== null) key(value.item); if (value.style !== null) key(value.style)
}
export function managementVisualSelected(value: Selector, facts: ManagementVisualFact[]) {
  selector(value)
  return facts.some(f => toHex(f.part) === toHex(value.part) && (value.product === null || (f.product === value.product && f.version === value.version))
    && (value.item === null || toHex(f.item) === toHex(value.item)) && (value.style === null || toHex(f.style) === toHex(value.style)))
}
/** Exact postfix visual::evaluate bounds: 288 tokens,32 leaves,depth8.
 * Empty programs are true. All children are validated/evaluated, including
 * operands whose boolean result could otherwise be short-circuited. */
export function evaluateManagementVisualProgram(tokens: Token[], facts: ManagementVisualFact[]) {
  check(tokens.length <= 288 && facts.length <= 512, 'BOUND')
  const stack: Array<{ value: boolean; depth: number }> = []; let leaves = 0
  for (const token of tokens) {
    check(Number.isInteger(token.opcode) && token.opcode >= 0 && token.opcode <= 3 && Number.isInteger(token.arity), 'TOKEN')
    if (token.opcode === 0) {
      check(token.selector !== null && token.arity === 0 && ++leaves <= 32, 'LEAF')
      stack.push({ value: managementVisualSelected(token.selector, facts), depth: 1 })
    } else {
      check(token.selector === null && (token.opcode === 1 ? token.arity === 1 : token.arity >= 1 && token.arity <= 32)
        && stack.length >= token.arity, 'ARITY')
      const children = stack.splice(stack.length - token.arity), depth = Math.max(...children.map(child => child.depth))
      check(depth < 8, 'DEPTH')
      const value = token.opcode === 1 ? !children[0].value : token.opcode === 2 ? children.every(child => child.value) : children.some(child => child.value)
      stack.push({ value, depth: depth + 1 })
    }
  }
  check(!tokens.length || stack.length === 1, 'PROGRAM')
  return tokens.length ? stack[0].value : true
}
/** Scene relation only; Pack callers supply local facts and owned-trigger
 * facts separately so another Pack's same-name component cannot trigger rules. */
export function assertManagementVisualRules(scene: Scene, facts: ManagementVisualFact[], options?: { inheritedRules: number; owned: ManagementVisualFact[] }) {
  const start = options?.inheritedRules ?? 0
  check(scene.rules.length <= 256 && Number.isSafeInteger(start) && start >= 0 && start <= scene.rules.length && facts.length <= 512, 'RULE_BOUND')
  for (const rule of scene.rules.slice(start)) {
    check((rule.kind === 0 || rule.kind === 1) && rule.targets.length > 0 && rule.targets.length <= 32, 'RULE')
    rule.targets.forEach(selector)
    if (!managementVisualSelected(rule.trigger, options?.owned ?? facts)) continue
    const targets = rule.targets.map(target => managementVisualSelected(target, facts))
    check(rule.kind === 0 ? rule.any ? targets.some(Boolean) : targets.every(Boolean) : !targets.some(Boolean), 'UNSATISFIED')
  }
  return { sceneRulesVerified: true as const, semanticRenderVerified: false as const }
}

export function assertManagementVisualColors(scene: Scene, choices: Array<{ channel: Uint8Array; swatch: Uint8Array | null }>) {
  check(choices.length === scene.channels.length, 'COLOR')
  choices.forEach((choice, i) => {
    const channel = scene.channels[i]
    check(toHex(choice.channel) === toHex(channel.key) && (choice.swatch === null || (channel.editable
      && channel.swatches.some(swatch => toHex(swatch.key) === toHex(choice.swatch!)))), 'COLOR')
  })
}
export function assertManagementAdditiveScene(base: Scene, extended: Scene) {
  const normalize = (scene: Scene) => ManagementSceneBcs.parse(ManagementSceneBcs.serialize(scene).toBytes())
  const a = normalize(base), b = normalize(extended), same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
  const frame = (scene: Scene) => { const { parts: _, tracks: __, channels: ___, anchors: ____, rules: _____, ...rest } = scene; return rest }
  check(same(frame(a), frame(b)), 'ADDITIVE_FRAME')
  for (const field of ['parts', 'channels', 'anchors', 'rules'] as const) check(a[field].length <= b[field].length && same(a[field], b[field].slice(0, a[field].length)), 'ADDITIVE_PREFIX')
  const tracks = b.tracks.filter(track => a.tracks.some(original => toHex(original.key) === toHex(track.key)))
  check(same(tracks, a.tracks) && b.anchors.slice(a.anchors.length).every(anchor => !a.anchors.some(original => toHex(original.key) === toHex(anchor.key))), 'ADDITIVE_REFERENCES')
}
