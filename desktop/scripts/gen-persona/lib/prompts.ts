export interface CharacterParams {
  referenceDescription: string
  primaryColors?: string
  vibe?: string
  signatureProp?: string
}

export type PromptMode = 'two-stage' | 'one-shot' | 'both'

export const STATE_ROWS = [
  { row: 0, name: 'idle',            frames: '0-7',   fps: 4,  loop: true,  label: '待机', intensity: 'LOW' },
  { row: 1, name: 'thinking',        frames: '8-15',  fps: 6,  loop: true,  label: '思考', intensity: 'MEDIUM' },
  { row: 2, name: 'completed',       frames: '16-23', fps: 4,  loop: false, label: '完成', intensity: 'LOW' },
  { row: 3, name: 'working',         frames: '24-31', fps: 8,  loop: true,  label: '工作', intensity: 'MEDIUM-HIGH' },
  { row: 4, name: 'needs-attention', frames: '32-39', fps: 4,  loop: true,  label: '提醒', intensity: 'LOW' },
  { row: 5, name: 'error',           frames: '40-47', fps: 2,  loop: true,  label: '生气', intensity: 'LOW' },
  { row: 6, name: 'dragging',        frames: '48-55', fps: 10, loop: true,  label: '拖拽', intensity: 'HIGH' },
] as const

function renderParamsPreamble(p: CharacterParams): string {
  const lines = [`ROLE: ${p.referenceDescription}`]
  if (p.primaryColors) lines.push(`PALETTE: ${p.primaryColors}`)
  if (p.vibe) lines.push(`PERSONALITY: ${p.vibe}`)
  if (p.signatureProp) lines.push(`SIGNATURE_PROP: ${p.signatureProp}`)
  return lines.join('\n')
}

export function buildKeyframePromptCN(p: CharacterParams): string {
  return `${renderParamsPreamble(p)}

以附图为角色参考，生成 7 张 512×512 Q 版贴纸，PNG 透明背景，
每张对应一个桌宠状态。严格保持同一角色：相同头型、相同比例、
相同配色、相同 2-3 像素黑色粗描边，扁平 2D 色块无渐变无阴影，
角色居中留 30% 边距。

1. idle（待机）：自然站立，双臂下垂，眼睛睁开，嘴角微扬
2. thinking（思考）：手托下巴或耳朵微抬，眼睛上翻，好奇神情
3. completed（完成）：双手高举，笑眼 (^_^)，庆祝姿态
4. working（工作）：身体微前倾，专注表情，头顶一滴小汗珠
5. needs-attention（提醒）：惊跳，大眼睛瞪圆，头上一个感叹号
6. error（生气）：嘟嘴皱眉，头顶冒白色蒸汽
7. dragging（被拽）：身体被拉长，眼睛打转，四肢瘫软

输出：7 张独立 PNG，512×512，透明背景（alpha 通道），
角色像素居中对齐。`
}

export function buildKeyframePromptEN(p: CharacterParams): string {
  return `${renderParamsPreamble(p)}

Generate 7 independent 512x512 chibi sprite images based on the
reference character. Transparent PNG background (alpha channel,
NO magenta key, NO solid fill). Keep identical character identity
across all 7 images: same head shape, same body proportions, same
palette, same 2-3px black outline. Flat 2D cel art, no gradient,
no shadow, no background scene. Character centered with ~30% padding.

1. idle — relaxed standing, arms down, eyes open, slight smile
2. thinking — hand near chin or ear twitch, eyes up, curious
3. completed — both arms raised, happy eyes (^_^), celebrating
4. working — forward lean, focused face, small sweat drop
5. needs-attention — startled jump, wide eyes, exclamation mark
6. error — angry pout, steam puffs from head
7. dragging — stretched limbs, dizzy spiral eyes, floppy`
}

export function buildLoopPrompt(stateName: string, intensity: string): string {
  return `Take this keyframe and generate an 8-frame seamless loop.
Frame 1 <-> Frame 8 must connect smoothly (cyclic or ping-pong).
Only subtle micro-motion: ears twitch, body sway +/- 5px, one blink,
hair/accessory bob. Do NOT change pose, palette, outline, or size.

Output: 8 separate 512x512 transparent PNGs.
State: ${stateName}
Motion intensity: ${intensity}`
}

export function buildOneShotPrompt(p: CharacterParams): string {
  const rowLines = STATE_ROWS.map(s =>
    `Row ${s.row} (cells ${s.frames}): ${s.name.toUpperCase().padEnd(16)} — 8-frame seamless loop, motion ${s.intensity}`
  ).join('\n')

  return `${renderParamsPreamble(p)}

Generate a 4096x3584 sprite sheet, 8 columns x 7 rows, each cell
512x512 px, transparent PNG background (alpha channel, no fill).
The SAME chibi character (matching reference image) appears in every
cell — identical identity, palette, 2-3px black outline, centered
with equal padding, no shadows, no scene elements.

${rowLines}

Keep perfect 8x7 grid alignment, no bleeding between cells,
no fill behind the character.`
}

export function buildAllPrompts(p: CharacterParams, mode: PromptMode): string {
  const sections: string[] = []

  if (mode === 'two-stage' || mode === 'both') {
    sections.push('=== STAGE A-1 · KEYFRAMES (CN) ===\n\n' + buildKeyframePromptCN(p))
    sections.push('=== STAGE A-1 · KEYFRAMES (EN) ===\n\n' + buildKeyframePromptEN(p))
    sections.push('=== STAGE A-2 · LOOP PROMPTS (per state) ===\n')
    for (const s of STATE_ROWS) {
      sections.push(`--- ${s.name} (row ${s.row}, ${s.label}) ---\n\n` + buildLoopPrompt(s.name, s.intensity))
    }
  }

  if (mode === 'one-shot' || mode === 'both') {
    sections.push('=== ONE-SHOT SPRITE SHEET ===\n\n' + buildOneShotPrompt(p))
  }

  return sections.join('\n\n')
}
