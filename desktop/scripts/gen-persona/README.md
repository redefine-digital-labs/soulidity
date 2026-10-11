# gen-persona — 桌宠角色资产生成

把任意一张角色参考图 → 符合 `apps/desktop/resources/default-persona/sprite-config.json`
规格的 56 帧透明精灵表 (`sprite.png` 4096×3584) + `manifest.json`。

## 规格速查

| 项 | 值 |
|---|---|
| 画布 | 4096 × 3584 PNG |
| 网格 | 8 列 × 7 行，每格 512×512 |
| 背景 | 透明（alpha 通道，非 `#FF00FF`） |
| 主体 | 居中，≈200–250 px，四周留白 |
| 风格 | 2–3 px 黑描边 + 扁平 2D 色块，无阴影无渐变 |

### 7 行状态映射

| 行 | 帧号 | 状态 | FPS | 循环 | 语义 |
|---|---|---|---|---|---|
| 0 | 0-7   | `idle`            | 4  | ✓ | 待机 |
| 1 | 8-15  | `thinking`        | 6  | ✓ | 思考 |
| 2 | 16-23 | `completed`       | 4  | ✗ | 完成 |
| 3 | 24-31 | `working`         | 8  | ✓ | 工作 |
| 4 | 32-39 | `needs-attention` | 4  | ✓ | 提醒 |
| 5 | 40-47 | `error`           | 2  | ✓ | 生气 |
| 6 | 48-55 | `dragging`        | 10 | ✓ | 拖拽 |

每行 8 帧必须首尾可无缝循环；高 FPS 行动作更夸张，低 FPS 行接近静帧。

---

## 方案 A：两阶段（推荐，质量稳）

### Step A-1 · 7 张关键帧

**中文提示词**

```
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
角色像素居中对齐。
```

**English prompt**

```
Generate 7 independent 512×512 chibi sprite images based on the
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
7. dragging — stretched limbs, dizzy spiral eyes, floppy
```

### Step A-2 · 每张关键帧 → 8 帧循环

对每张关键帧单独跑一次：

```
Take this keyframe and generate an 8-frame seamless loop.
Frame 1 ↔ Frame 8 must connect smoothly (cyclic or ping-pong).
Only subtle micro-motion: ears twitch, body sway ±5px, one blink,
hair/accessory bob. Do NOT change pose, palette, outline, or size.

Output: 8 separate 512×512 transparent PNGs.
Motion intensity: {{LOW | MEDIUM | HIGH}}
 - idle / completed / needs-attention / error  → LOW
 - thinking                                     → MEDIUM
 - working                                      → MEDIUM-HIGH
 - dragging                                     → HIGH (floppy wobble)
```

---

## 方案 B：单次一张图（快速草稿）

```
Generate a 4096×3584 sprite sheet, 8 columns × 7 rows, each cell
512×512 px, transparent PNG background (alpha channel, no fill).
The SAME chibi character (matching reference image) appears in every
cell — identical identity, palette, 2-3px black outline, centered
with equal padding, no shadows, no scene elements.

Row 0 (cells 0-7):   IDLE             — standing, breathing, 1 blink
Row 1 (cells 8-15):  THINKING         — hand-to-chin, eyes tracking
Row 2 (cells 16-23): COMPLETED        — arms raise, happy eye-close hold
Row 3 (cells 24-31): WORKING          — forward lean, busy motion
Row 4 (cells 32-39): NEEDS-ATTENTION  — jump up frames 1-4, bounce 5-8
Row 5 (cells 40-47): ERROR            — pouting, steam grows and fades
Row 6 (cells 48-55): DRAGGING         — stretched floppy wobble

Each row is an 8-frame seamless loop. Keep perfect 8×7 grid alignment,
no bleeding between cells, no fill behind the character.
```

⚠️ 单次生成常见翻车：变脸、网格错位、角色大小漂移。只作草稿用，终稿走方案 A。

---

## 参数化模板

在 `1-prompt.ts` 里，这些占位会被替换：

| 占位 | 示例 |
|---|---|
| `{{referenceDescription}}` | 穿白大褂的柴犬博士 |
| `{{primaryColors}}` | 奶白 `#F5E6D3` + 浅棕 `#C68B5B` |
| `{{vibe}}` | 温和好奇，略带呆萌 |
| `{{signatureProp}}` | 脖子上的红围巾 |

---

## 脚本用法

```bash
# 全自动（参考图 → API → 56 帧 → 拼表 → manifest → 落盘）
pnpm tsx desktop/scripts/gen-persona/orchestrate.ts \
  --ref ./柴犬.png --name "柴犬博士" --mode two-stage

# 只出提示词（手动贴 Midjourney / 豆包）
pnpm tsx desktop/scripts/gen-persona/1-prompt.ts \
  --params ./params.json --mode both > prompt.txt

# 只调 API
pnpm tsx desktop/scripts/gen-persona/2-generate.ts \
  --ref ./柴犬.png --name "柴犬博士" --mode two-stage \
  --provider openai

# 只拼表（已有 56 张手绘 PNG，文件名 00.png ~ 55.png）
pnpm tsx desktop/scripts/gen-persona/3-stitch.ts \
  --frames ./frames/ --out ./sprite.png

# 只写 manifest
pnpm tsx desktop/scripts/gen-persona/4-manifest.ts \
  --name "柴犬博士" --description "汪！" \
  --out ./manifest.json
```

### params.json 结构

```json
{
  "referenceDescription": "穿白大褂的柴犬博士",
  "primaryColors": "奶白 #F5E6D3 + 浅棕 #C68B5B",
  "vibe": "温和好奇，略带呆萌",
  "signatureProp": "脖子上的红围巾"
}
```

---

## 验证

1. `sips -g pixelWidth -g pixelHeight -g hasAlpha sprite.png` → 4096×3584 且 `hasAlpha: yes`
2. 把产物放到 `desktop/data/assets/<角色>/`，启动 desktop，切换 persona，触发 12 种 mood 看每行动画是否正常循环（参考 `packages/backend/src/memory/mood.ts` 的优先级）
3. `pnpm test` + `pnpm lint`

---

## 前置依赖

2-generate / 3-stitch / orchestrate / migrate-usagi 都依赖 `sharp`：

```bash
pnpm add -D -w sharp
```

根据选择的 provider 设置环境变量：

- `--provider openai` → `OPENAI_API_KEY`
- `--provider gemini` → `GEMINI_API_KEY`（Nano Banana / Gemini 2.5 Flash Image）

---

## 可选：把现有乌萨奇迁移到透明底

现有 `sprite.png` 是洋红 `#FF00FF` 背景，运行时由 `apps/desktop/src/renderer/lib/chroma-key.ts`
做 YUV 距离 + flood fill + despill 实时抠图。新流水线直接产透明 PNG，不需要运行时抠图。

想把乌萨奇也迁到透明底：

```bash
# 先装 sharp
pnpm add -D -w sharp

# 备份 + 迁移（两处 sprite.png 一起）
pnpm tsx desktop/scripts/gen-persona/migrate-usagi.ts

# 只迁指定文件
pnpm tsx desktop/scripts/gen-persona/migrate-usagi.ts --file ./some/sprite.png
```

原文件会保留为 `sprite.png.bak`。想还原：`cp sprite.png.bak sprite.png`。

**迁移完再简化运行时**（可选，减 300+ 行）：把
`apps/desktop/src/renderer/lib/chroma-key.ts` 的 `processSpriteSheeet` 改成把 `HTMLImageElement`
直接画到 `<canvas>` 的 passthrough，移除 YUV/flood-fill/despill 逻辑。验证方式：
`pnpm test` + `pnpm dev` 启动 desktop，切换乌萨奇 persona，观察 7 行动画边缘无洋红毛刺。

### 为什么不自动执行这两步

- 覆盖 `sprite.png` 是破坏性操作，需要人类确认备份可用再做。
- 简化 `chroma-key.ts` 只在乌萨奇迁完之后才安全，不能单独做。
- 现有 `chroma-key.ts` 对透明 PNG 已经兼容（`isBgCandidate` 中 `alpha<16` 直接判背景），
  新生成的透明资产**无需迁移也能直接使用**，所以这两步是纯粹的代码瘦身，不影响新角色开工。
