# Desktop Companion — Soulidity Desktop Persona Manager

---

## Goal

构建桌面形象管理应用，将 Soulidity Soul 生态延伸到桌面端。核心能力：根据 LLM CLI（Claude Code / Codex）的运行状态实时切换桌面形象动画，形象资产从 Soul 市场下载并通过链上访问控制保护，桌面端自带 Sui agent 地址参与 Soul 交互。

## Scope

### Phase 1 — Companion Shell（当前执行目标）

1. **统一状态协议** — `~/.soulidity/agent-status.json` 文件监听 + Claude Code / Codex / OpenCode 适配器
2. **AgentMonitor 被动检测** — 进程探测（pgrep）+ JSONL 会话日志监听，无 hook 也能感知 CLI 状态
3. **双窗口 Electron 应用** — 主窗口（library / market / settings / agent 管理）+ 透明悬浮窗口
4. **Sprite Sheet 渲染** — Canvas API 逐帧动画，接入本地默认 persona 和 CLI 状态驱动
5. **桌面 Agent 钱包** — 每设备一个 Ed25519 agent 地址，显示于 settings

### Phase 2 — Soul Integration

1. **Soul Meta 扩展** — `metadata_ref` 指向 JSON，声明形象格式、状态映射、资产引用
2. **SoulAssets 内容层** — Move 模块，与 Skills 同构（`Table<String, vector<AssetSlot>>`）
3. **ContentAccessList** — Move 模块，独立于 grant 的内容访问权售卖机制
4. **账号与内容联动** — Privy 钱包 + 桌面 agent 地址绑定、市场下载、受保护内容访问
5. **Soul 抽取铸造** — 从本地 LLM 对话日志提取人格特征，引导用户铸造 Soul

### 不做（预留）

- Live2D 高级渲染格式
- 语音系统（预录音频 + TTS 实时合成）
- 聊天面板 / LLM 对话能力 / LLM Key 配置

---

## Locked Decisions

| 决策 | 结论 | 原因 |
|------|------|------|
| 桌面运行时 | Electron（Desktop-Claw fork） | 不保留 Tauri 并行方案 |
| 钱包存储 | keytar（OS keychain） | 不明文存 JSON |
| 地址推导 | `keypair.toSuiAddress()` / Sui SDK 语义 | 不手写 SHA-256/blake2b |
| 状态协议 | 6 态文件协议 `~/.soulidity/agent-status.json` | 统一 CLI 适配 |
| 检测策略 | 双层：Hooks 主动上报 + AgentMonitor 被动检测 | Confirmo 验证模式，无 hook 也能工作 |
| 情绪系统 | 12 mood（Confirmo 风格），CLI 6 态 + 上下文规则映射 | 替代旧 4 emotion |
| Sprite 渲染 | 原生 Canvas API + requestAnimationFrame | 不引入 Phaser/Pixi |
| 依赖位置 | Phase 1 所有桌面依赖放 `apps/desktop/package.json` | 不放 `packages/backend` |

---

## Current Implementation Drift（需按 spec 清理）

以下偏差已经在仓库中出现，但**不视为 spec 已变更**；后续实施必须回到本文档目标态，而不是继续扩展这些临时实现。

1. **聊天/LLM 配置漂移** — 当前桌面端已有 `ChatPanel`、`QuickInput`、`useClawSocket` 和 LLM Key/Model 设置入口；这些与“不做聊天面板 / LLM 对话能力 / LLM Key 配置”的范围冲突，后续要删除，不再扩展。
2. **情绪系统漂移** — 当前渲染层仍在使用 4 态 emotion fallback（`idle/busy/done/night`）和 CLI 6 态直接映射；目标仍是 12 mood + `useMoodResolver` + unified event。
3. **窗口结构漂移** — 当前实现是 `FloatingBall + ChatPanel + SettingsPanel` 三视图/三窗口；目标仍是 `MainWindow + OverlayWindow` 双窗口模型。
4. **钱包存储漂移** — 当前私钥仍有临时 JSON 落盘；目标仍是 `keytar` / OS keychain，不能把明文 JSON 视为已接受方案。

---

## Architecture

### Target Tech Stack

Electron, React, electron-vite, pnpm workspace, Node `fs.watch`, chokidar, Canvas API, `@mysten/sui`, `keytar`

> 当前实现尚未完全收口：`keytar`、`agent-monitor.ts`、`useMoodResolver.ts` 仍未落地；`chokidar` 仅作为 AgentMonitor 目标技术选项，不代表现阶段已闭环。

### Workspace Layout

```
desktop/                          # Desktop-Claw-based pnpm workspace
├── apps/desktop/
│   ├── src/main/                 # Electron main process
│   │   ├── index.ts              # lifecycle
│   │   ├── status-watcher.ts     # ~/.soulidity/ file watcher (hooks 层)
│   │   ├── agent-monitor.ts      # 被动检测层 (进程 + JSONL 日志)
│   │   └── agent-wallet.ts       # Ed25519 keypair management
│   ├── src/preload/              # IPC bridge
│   ├── src/renderer/
│   │   ├── components/
│   │   │   ├── FloatingBall/     # overlay sprite + interaction
│   │   │   ├── MainWindow/       # library / market / settings / agent 管理
│   │   │   └── AgentWallet/      # MainWindow settings wallet display
│   │   └── hooks/
│   │       ├── useCliStatus.ts   # CLI status subscription (hooks + monitor 聚合)
│   │       ├── useMoodResolver.ts # 事件→mood 状态机
│   │       └── useClawEmotion.ts # backend emotion fallback
│   └── resources/
│       ├── hooks/                # CLI adapter scripts
│       └── default-persona/      # bundled sprite assets
├── packages/backend/             # Desktop-Claw backend (Fastify)
└── packages/shared/              # shared types
    └── src/types/cli-status.ts   # canonical status protocol types
```

### Window Model

```
Electron Main Process
├── window lifecycle
├── status watcher (hooks 层)
├── agent monitor (被动检测层)
├── wallet IPC
└── secure storage / protocol wiring

MainWindow（Desktop-Claw 主面板）
├── library / market / settings / agent 管理
├── agent wallet / agent monitor 状态面板
└── 后续可扩展 marketplace / auth / grants / soul 抽取

OverlayWindow（透明悬浮 companion）
├── transparent, frameless, alwaysOnTop, skipTaskbar
├── 初始尺寸：256x256（可配置）
├── 位置：记忆上次位置（userData/state/overlay_position.json）
└── 内容：Canvas sprite 动画 + 状态气泡 + 右键菜单
```

### OverlayWindow Interaction

| 操作 | 行为 |
|------|------|
| 拖拽 | 移动位置（`-webkit-app-region: drag`），松手保存位置 |
| 左键点击 | 展开状态气泡（当前 session 摘要） |
| 右键 | 上下文菜单：切换形象 / 打开主窗口 / 收回宠物 / 设置 |
| 状态变化 | 播放过渡动画 |
| 无活跃 session | 显示 idle 动画 |

### Target Local Storage

```
userData/
├── state/
│   ├── active_persona.json       # 当前激活 persona
│   ├── agent_keypair.json        # 仅 public metadata
│   └── overlay_position.json     # 悬浮窗口位置
└── personas/
    ├── bundles/                  # 已安装 persona bundle
    └── runtime/                  # 解密后的形象资产
```

- private key 不落本地 JSON，统一走 OS keychain（`keytar`）
- `auth_session`、`catalog_cache`、额外派生状态仅在对应登录/市场能力落地时引入，不提前写成 Phase 1 既有事实

---

## Module Specifications

### Module 1 — 双层状态检测

#### 1A — Hooks 主动上报层

**文件结构：**
```
~/.soulidity/
├── agent-status.json          # 当前唯一 source of truth（Electron watcher 监听）
└── sessions/
    └── {session_id}.json      # 预留：按 session 拆文件的扩展目录
```

Phase 1 的 renderer/main 只依赖 `agent-status.json`；`sessions/` 不是阻塞项。

**状态模型：**
```typescript
interface AgentStatusFile {
  version: 1
  lastUpdated: number
  sessions: Record<string, AgentSession>
}

interface AgentSession {
  sessionId: string
  clientType: 'claude-code' | 'codex' | 'opencode' | 'custom'
  status: 'idle' | 'thinking' | 'working' | 'needs-attention' | 'completed' | 'error'
  workingDirectory?: string
  sessionTitle?: string
  currentAction?: {
    tool?: string
    details?: string
    timestamp: number
  }
  needsAttention?: string
  startedAt: number
  lastUpdated: number
  endedAt?: number
}
```

**适配器：**

`soulidity-claude-hook.cjs` — 6 种 Claude Code hook 事件：

| Hook Event | → Status |
|------------|----------|
| `SessionStart` | `idle` |
| `UserPromptSubmit` | `working` |
| `PreToolUse` | `working` + currentAction |
| `PostToolUse` | `working`（清除 currentAction） |
| `Stop` | `completed` |
| `SessionEnd` | `idle` |

- stdin 接收 JSON，原子写入（temp + rename）
- 检测 attention tools（AskUserQuestion、ExitPlanMode）→ `needs-attention`
- 24h 自动清理过期 session

`soulidity-codex-hook.cjs` — Codex `notify` 事件：

| Event Type | → Status |
|------------|----------|
| `agent-turn-complete` | `completed` |

- 命令行参数接收 JSON
- 支持转发到用户原有 notify 命令

`soulidity-opencode-plugin.ts` — OpenCode plugin 事件：

| Event Type | → Status |
|------------|----------|
| `session.created` | `idle` |
| `session.status` (busy) | `working` |
| `session.status` (idle) / `session.idle` | `completed` |
| `session.error` | `error` |
| `tool.execute.before` | `working` + currentAction |
| `tool.execute.after` | `working`（清除 attention） |
| `session.deleted` | `idle` + endedAt |

- 安装到 `~/.config/opencode/plugin/`
- 注意工具 `ask`/`confirm` → `needs-attention`
- `session.updated` / `message.updated` 仅更新 metadata，不改状态

**Electron 主进程侧（status-watcher.ts）：**
- watch `~/.soulidity/`，启动时先读一次当前状态
- debounce 后解析 JSON，广播 `agent-status-changed` 到所有需要的窗口
- 容忍原子写入过程中的短暂半成品文件

#### 1B — AgentMonitor 被动检测层

不依赖 hook 安装，通过进程探测 + 日志文件解析实现被动感知。作为 hooks 层的补充，两层事件合并后统一驱动 mood resolver。

**支持的 CLI Agent：**

```typescript
interface AgentConfig {
  name: string
  displayName: string
  processPatterns: string[]     // pgrep 匹配模式
  logPaths?: string[]           // 会话日志根目录
  filePatterns?: string[]       // 日志文件 glob
  completionPatterns?: RegExp[] // 文本完成特征
  errorPatterns?: RegExp[]      // 错误特征
}

const AGENT_CONFIGS: AgentConfig[] = [
  {
    name: 'claude-code',
    displayName: 'Claude Code',
    processPatterns: ['claude-code', '@anthropic-ai/claude-code', 'bin/claude'],
    logPaths: ['~/.claude/projects'],
    filePatterns: ['**/*.jsonl'],
  },
  {
    name: 'codex',
    displayName: 'Codex',
    processPatterns: ['codex', '@openai/codex'],
    logPaths: ['~/.codex/sessions'],
    filePatterns: ['**/*.jsonl'],
  },
  {
    name: 'aider',
    displayName: 'Aider',
    processPatterns: ['aider'],
  },
  {
    name: 'droid',
    displayName: 'Droid (Factory)',
    processPatterns: ['droid', '@anthropic-ai/droid', 'factory-cli'],
    logPaths: ['~/.factory/sessions', '~/.config/factory/sessions'],
    filePatterns: ['**/*.jsonl', '**/*.json'],
  },
  {
    name: 'opencode',
    displayName: 'OpenCode',
    processPatterns: ['opencode', '@sst/opencode'],
    logPaths: ['~/.local/share/opencode/storage/message', '~/.local/share/opencode/storage/part'],
    filePatterns: ['**/*.json'],
  },
]
```

**检测机制：**

| 层 | 方式 | 频率 | 能力 |
|----|------|------|------|
| 进程探测 | `pgrep -f` (macOS/Linux) / `tasklist` (Windows) | 每 3s 轮询 | agent-start / agent-stop |
| 日志文件监听 | chokidar 增量读取 JSONL | 文件变化触发 | agent-active / task-complete / needs-attention |
| Codex JSONL 轮询 | 直接 stat + read（chokidar 在 Electron 中不可靠） | 随进程轮询 | 同上 |

**事件模型（hooks 和 monitor 共用）：**
```typescript
type AgentEventType =
  | 'agent-start'        // 进程启动
  | 'agent-stop'         // 进程退出
  | 'agent-active'       // 正在工作
  | 'agent-idle'         // session 空闲
  | 'task-complete'      // 任务完成
  | 'task-error'         // 任务出错
  | 'needs-attention'    // 等待用户输入

interface AgentEvent {
  type: AgentEventType
  agent: string           // displayName
  timestamp: number
  details?: string
  sessionId?: string
  sessionTitle?: string
  workingDirectory?: string
}
```

**JSONL 解析策略：**
- 增量读取：记录每个文件的 `lastLogPosition`，只读新增内容
- 断行容错：pending 半行缓存，等下次拼接
- 过期文件跳过：>10min 未更新的 JSONL 视为 stale
- Claude Code：解析 `type: "user"` / `type: "assistant"` + `isMeta` / tool_use 等字段
- Codex：解析 `event_msg` + `response_item` payload 类型
- OpenCode：解析完整 JSON 文件（message / part）

**hooks 排除逻辑：**
- 已安装 hook 的 agent（如 claude-code、codex）在 AgentMonitor 中排除 JSONL 日志监听，仅保留进程探测
- 未安装 hook 的 agent（如 aider、droid）走完整 AgentMonitor 检测

**Electron 主进程侧（agent-monitor.ts）：**
- 启动时创建 AgentMonitor 实例，注入排除列表
- 每 3s 轮询进程列表 + 检查 JSONL 变化
- 事件通过 `onEvent` 回调统一汇入，与 status-watcher.ts 的事件合并后广播到 renderer

### Module 2 — 双窗口 Electron 应用

以下为**目标态 IPC 合约**。当前已落地的主要是 status-file / wallet 基础通道；`agent-monitor`、`installed hooks`、`unified events` 等仍待补齐。

**IPC Contracts：**
```ts
// overlay lifecycle
spawnPetOverlay(position?: Position): Promise<void>
closePetOverlay(): Promise<void>
setOverlayPosition(x: number, y: number): Promise<void>
getOverlayPosition(): Promise<Position | null>

// agent wallet
generateAgentKeypair(): Promise<AgentKeypairInfo>
loadAgentKeypair(): Promise<AgentKeypairInfo | null>
exportAgentAddress(): Promise<string>

// status protocol (hooks 层)
getCurrentAgentStatus(): Promise<AgentStatusFile | null>
onAgentStatusChanged(listener: (status: AgentStatusFile) => void): () => void

// agent monitor (被动检测层)
getMonitoredAgents(): Promise<{ name: string; displayName: string; running: boolean }[]>
onAgentEvent(listener: (event: AgentEvent) => void): () => void
getInstalledHooks(): Promise<{ agent: string; installed: boolean }[]>

// unified events (两层合并)
onUnifiedAgentEvent(listener: (event: AgentEvent) => void): () => void
```

### Module 3 — Sprite Sheet 渲染

**配置：**
```typescript
interface SpriteSheetConfig {
  src: string
  frameWidth: number
  frameHeight: number
  columns: number
  animations: {
    [stateName: string]: {
      frames: number[]
      fps: number
      loop: boolean
    }
  }
}
```

**渲染器：**
```typescript
class SpriteRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private sheet: HTMLImageElement
  private config: SpriteSheetConfig
  private currentAnimation: string
  private currentFrame: number
  private lastFrameTime: number

  play(animationName: string): void
  stop(): void
  private tick(timestamp: number): void
  private drawFrame(frameIndex: number): void
}
```

**状态驱动：** CLI status 变化 → mood resolver 综合 CLI 状态 + 上下文（时长、连续完成数、用户交互）→ 选择 mood → 切换动画。非 loop 动画播完自动回 idle。

**12 Mood 系统（Confirmo 风格）：**

| Mood | 精灵图行 | 动画效果 | 触发条件 |
|------|----------|----------|----------|
| idle | Row 0 | 缓慢呼吸式浮动 | 无活跃 session（默认） |
| happy | Row 1 | 小幅上下弹跳 | 任务完成 |
| love | Row 1 | 轻微缩放 + 左右摇摆 | idle 下特定触发（用户互动） |
| excited | Row 2 | 快速弹跳 + 缩放循环 | 连续完成多任务 |
| celebrate | Row 2 | 大幅跳跃 + 旋转 + 放大 | 重大任务完成（长 session 结束） |
| sleepy | Row 3 | 缓慢摇晃（3s 周期） | idle >30s 无活动 |
| snoring | Row 3 | 更慢的呼吸缩放（2.5s 周期） | idle >60s 无活动 |
| working | Row 4 | 根据 task 数量动态调整抖动强度（1–5 级） | CLI thinking/working |
| angry | Row 5 | 左右快速抖动 | CLI error |
| surprised | Row 5 | 弹跳放大 | CLI needs-attention |
| shy | Row 5 | 侧倾缩回 | 用户注视/hover 时的被动反应 |
| dragging | Row 6 | 跟随拖拽的物理弹簧效果 | 用户拖拽窗口 |

**默认 persona（乌萨奇）：** 4096x3584 PNG，8 列 x 7 行，512x512 帧，共 56 帧。

| 行 | 帧范围 | Mood |
|----|--------|------|
| 0 | 0-7 | idle |
| 1 | 8-15 | happy, love |
| 2 | 16-23 | excited, celebrate |
| 3 | 24-31 | sleepy, snoring |
| 4 | 32-39 | working |
| 5 | 40-47 | angry, surprised, shy |
| 6 | 48-55 | dragging |

**CLI 6 态 → Mood 默认映射：**

| CLI Status | → Default Mood | 上下文升级 |
|------------|----------------|-----------|
| idle | idle | >30s→sleepy, >60s→snoring（可配置） |
| thinking | working（level 1） | — |
| working | working（level 1-5） | 按活跃 task 数量动态调整 |
| needs-attention | surprised | — |
| completed | happy | 连续完成→excited, 长 session→celebrate |
| error | angry | — |

**交互触发 Mood（不依赖 CLI 状态）：**
- `dragging` — 用户拖拽悬浮窗口时
- `love` — idle 状态下用户持续抚摸（mousemove over pet）
- `shy` — idle 状态下用户 hover
- 点击 idle/sleepy/snoring → `happy`（2s 后回 idle）
- 点击 happy → `excited`（1.5s 后回 idle）

**Celebrate 编排（Confirmo 验证模式）：**
```
task-complete 事件
  → celebrationLock = true
  → setMood('celebrate')
  → 2s 后 → setMood('happy')
  → 5s 后 → celebrationLock = false
             → 有其他活跃 task → 'working'
             → 无活跃 task → 'idle'

celebrationLock 期间忽略 agent-active 事件，防止新活动打断庆祝动画
```

**Sleepy/Snoring 定时器：**
```
mood === 'idle' 且 idleAnimations 开启
  → 每 5s 检查 Date.now() - lastActivityTime
  → >30s → setMood('sleepy')
  → >60s → setMood('snoring')
  → 用户点击/拖拽/新事件 → 重置 lastActivityTime，退出 sleepy/snoring
```

**Activity Frequency（working 动态强度）：**
- 5s 滑动窗口内的 agent-active 事件计数
- 频率 = min(count / 4, 5) → 映射到 working 抖动 level 1-5

**FloatingBall 集成：**
```tsx
// 统一事件驱动（hooks + monitor 合并后的 AgentEvent 流）
const { mood, activeTasks, activityFrequency } = useMoodResolver()

<SpriteRenderer
  config={spriteConfig}
  animation={mood}
  activeTasks={activeTasks}
  activityFrequency={activityFrequency}
  isDragging={isDragging}
  width={56} height={56}
/>
```

`useMoodResolver` 内部：
1. 订阅 `onUnifiedAgentEvent`（hooks + monitor 合并事件）
2. 维护 activeTasks 列表（按 sessionId 去重）
3. 根据事件类型 + 上下文计算 mood
4. 管理 celebrationLock / moodTimeouts / lastActivityTime

CSS halo 保留为叠加层，`data-mood` 驱动 halo 颜色变化。

### Module 4 — Soul Metadata 扩展（Phase 2）

Soul 链上 `metadata_ref: Option<String>` 指向 JSON metadata URL（Walrus public blob）。

```typescript
interface SoulMetadata {
  version: 1
  persona?: {
    format: 'sprite-sheet' | 'live2d'
    moodMap: {
      idle: string; happy: string; love: string
      excited: string; celebrate: string
      sleepy: string; snoring: string
      working: string
      angry: string; surprised: string; shy: string
      dragging: string
    }
    publicAssets?: SpriteSheetAsset
    protectedAssets?: { assetName: string; versionIndex: number }
  }
  voice?: { /* 预留 */ }
  extra?: Record<string, unknown>
}
```

**桌面端下载流程：** 读 metadata_ref → 解析 persona → publicAssets 直接下载 / protectedAssets 按权限（owner → grant → ContentAccessList）解密下载 → 存入 `userData/personas/runtime/{soul-id}/`。

### Module 5 — SoulAssets 内容层（Phase 2）

与 `skills.move` 同构设计。

```move
public struct AssetSlot has copy, drop, store {
    blob_object_id: ID,
    is_public: bool,
    deleted: bool,
    asset_type: u8,     // 0=sprite, 1=live2d, 2=audio
    created_at_ms: u64,
}

public struct SoulAssets has key {
    id: UID,
    soul_id: ID,
    assets: table::Table<String, vector<AssetSlot>>,
    asset_count: u64,
}
```

**写入函数：** `append_as_owner`, `append_as_granted_agent`, `soft_delete_as_owner`

**Seal Policy：** `seal_approve_asset_read_owner`, `seal_approve_asset_read_granted_agent`

**Seal document ID 格式：** `soul-asset:{version}:{assets_id}:{asset_name}:{version_index}:{nonce}`

**Prisma：** `SoulAssetVersionRecord` — `@@unique([assetsOnChainId, assetName, versionIndex])`

**API Routes：**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/souls/[id]/assets` | GET | 列出资产 |
| `/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/access` | GET | Human 访问 |
| `/api/agent/souls/[id]/assets/[assetName]/versions/[versionIndex]/access` | GET | Agent 访问 |
| `/api/souls/[id]/assets/append` | POST | 上传新版本 |
| `/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/delete` | POST | 软删除 |

### Module 6 — ContentAccessList（Phase 2）

独立于 grant 体系，不随 Soul 所有权转移失效。

```move
public struct ContentAccessList has key {
    id: UID,
    soul_id: ID,
    creator: address,
    entries: table::Table<address, ContentAccessEntry>,
    entry_count: u64,
}

public struct ContentAccessEntry has copy, drop, store {
    scope_mask: u64,           // SCOPE_SKILLS=4, SCOPE_ASSETS=8
    price_paid_atomic: u64,
    granted_at_ms: u64,
    expires_at_ms: Option<u64>,
}
```

**Scope 常量（扩展现有）：**
```
SCOPE_SEAL=1, SCOPE_MEMORY=2, SCOPE_SKILLS=4, SCOPE_ASSETS=8
```

**操作：** `purchase_content_access`（链上 USDC）, `add_access`（creator/owner 手动）, `revoke_access`, `set_content_price`

**分润：** 复用 MarketConfig（platform_fee_bps + creator_royalty_bps）

**Seal Policy 扩展：** `seal_approve_skill_allowlisted`, `seal_approve_asset_allowlisted`

**访问判定优先级：**
1. viewer 是 owner → `seal_approve_*_read_owner`
2. viewer 有 active grant → `seal_approve_*_read_granted_agent`
3. viewer 在 ContentAccessList → `seal_approve_*_allowlisted`
4. 均不满足 → 403

**API Routes：**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/souls/[id]/access-list` | GET | 查询 |
| `/api/souls/[id]/access-list/purchase` | POST | 链上付款同步 |
| `/api/souls/[id]/access-list/add` | POST | 手动添加 |
| `/api/souls/[id]/access-list/revoke` | POST | 撤销 |

### Module 7 — 双钱包与 Agent 身份

```ts
interface AgentKeypairInfo {
  address: string     // Sui address (0x...)
  publicKey: string   // hex-encoded
  createdAt: number
}
```

- Sui SDK `toSuiAddress()` 推导地址
- public metadata → `userData/state/agent_keypair.json`
- private key → OS keychain via `keytar`
- 每台设备一个 agent 地址

**登录绑定：** 浏览器登录 → 桌面端上报 agent_address → `POST /api/desktop/me/agent` → 关联到 Member

| 场景 | 钱包 |
|------|------|
| 购买 Soul / 内容 / 铸造 | Privy 钱包 |
| 接收 grant / 读写 memory/skills | Agent 地址 |
| 下载已购形象（allowlist） | Privy 钱包地址 |

### Module 8 — Soul 抽取铸造（Phase 2）

从本地 LLM 对话日志中提取人格特征，引导用户构建 Soul 并铸造上链。

**数据源：**

| CLI | 日志路径 | 格式 |
|-----|----------|------|
| Claude Code | `~/.claude/projects/<encoded-path>/<session>.jsonl` | JSONL，每行一个 message/tool_use |
| Codex | `~/.codex/sessions/YYYY/MM/DD/<session>.jsonl` | JSONL，event_msg/response_item |
| OpenCode | `~/.local/share/opencode/storage/message/*.json` | 单条 JSON |

**抽取流程：**

```
1. 扫描本地日志
   → AgentMonitor.logPaths 已知，直接复用
   → 按 mtime 排序，展示 session 列表（标题、时间、agent 类型）

2. 用户选择 session(s)
   → 读取 JSONL，提取 user/assistant 对话轮次
   → 过滤系统消息、工具调用细节（仅保留摘要）
   → 统计：总轮次、主题分布、工具使用偏好、编程语言

3. 人格分析（本地 LLM 或 API）
   → 输入：对话摘要 + 统计
   → 输出：SoulProfile（性格标签、专长、沟通风格、典型回复模式）
   → 用户可编辑/确认

4. 铸造引导
   → 填充 Soul metadata（name、description、persona traits）
   → 可选：关联 sprite sheet 形象
   → 调用 mint_native_in_personal_kiosk 上链
```

**数据模型：**

```typescript
interface SessionSummary {
  sessionId: string
  agent: string                 // 'claude-code' | 'codex' | 'opencode'
  title?: string
  workingDirectory?: string
  startedAt: number
  messageCount: number
  filePath: string
}

interface SoulProfile {
  name: string
  description: string
  traits: string[]              // e.g. ['methodical', 'concise', 'security-conscious']
  expertise: string[]           // e.g. ['TypeScript', 'Sui Move', 'React']
  communicationStyle: string    // e.g. 'direct, code-first, minimal prose'
  sampleResponses: string[]    // 3-5 representative snippets
}

interface ExtractionResult {
  sessions: SessionSummary[]
  totalMessages: number
  profile: SoulProfile
  rawStats: {
    topLanguages: Record<string, number>
    topTools: Record<string, number>
    avgResponseLength: number
    topicClusters: string[]
  }
}
```

**IPC：**
```ts
// soul extraction (Phase 2)
listLocalSessions(agent?: string): Promise<SessionSummary[]>
extractSoulProfile(sessionIds: string[]): Promise<ExtractionResult>
```

**隐私约束：**
- 所有分析在本地完成，原始对话内容不上传
- 仅提取统计特征和风格模式，不包含业务代码或密钥
- 用户可在铸造前逐项审阅和编辑提取结果
- 铸造后链上存储的是 SoulProfile（元数据），不是原始对话

---

## Web Desktop API Routes（Phase 1 集成，位于 `web/app/api/desktop/*`）

### Prisma Models

`DesktopProfile`, `DesktopCatalogEntry`, `DesktopDeviceSession` — 详见 `prisma/schema.prisma`。

### API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/desktop/me` | GET | Human | profile + active persona |
| `/api/desktop/me/active-persona` | PUT | Human | 切换 active persona |
| `/api/desktop/catalog` | GET | Anonymous | 分页 catalog |
| `/api/desktop/catalog/[id]` | GET | Anonymous | persona manifest + 下载信息 |
| `/api/desktop/device/start` | POST | Anonymous | 创建设备绑定 session |
| `/api/desktop/device/poll` | POST | Anonymous | 轮询绑定状态 |
| `/api/desktop/device/complete` | POST | Human | 确认设备绑定 |

### 支撑库

| 文件 | 功能 |
|------|------|
| `web/lib/desktop/profile.ts` | getDesktopMe, setDesktopActivePersona |
| `web/lib/desktop/device-session.ts` | start/poll/complete DesktopDeviceSession |
| `web/lib/desktop/repository.ts` | listDesktopCatalogItems, findDesktopPersonaManifestById |
| `web/lib/types/desktop.ts` | Desktop API response types |

### Embedded Desktop Backend（Electron 本地 Fastify）

本地桌面后端与上面的 web `/api/desktop/*` 不是同一个服务。当前内嵌后端提供：

- `GET /health`
- `GET /ws`
- `GET /calendar/dates`
- `GET /calendar/:date`
- `GET /calendar/:date/messages`
- `GET /persona`
- `GET /greeting`
- `GET /emotion`
- `POST /emotion/interact`

---

## Data Flow

### 创作者发布形象资产（Phase 2）

```
绘制 sprite sheet
  → 上传 Walrus（加密或公开）
  → 构建 SoulMetadata JSON → 上传 Walrus public blob → 获取 URL
  → mint Soul (metadata_ref = URL)
  → 可选：设定内容访问价格
  → marketplace 展示
```

### 买家购买与使用

```
浏览 marketplace → 预览公开形象
  → purchase_content_access() 链上 USDC 付款
  → 地址加入 ContentAccessList
  → web 端可查看已购内容

桌面端：
  → 登录 → 浏览已购形象
  → 下载解密到本地 → 选择 active persona → "放出"悬浮窗口
  → file watcher 监听 CLI 状态 → 状态变化 → sprite 切换动画帧
```

### Agent 授权

```
用户有 Soul → web 端给桌面 agent 地址 issue grant
  → 桌面端 agent 通过 grant 访问 memory/skills
  → 未来：agent 自主读写
```

---

## Constraints

- Desktop-Claw Electron workspace 为基础扩展，不保留 Tauri
- Move 新增模块不修改现有 Soul/SoulState 核心字段（除 `assets_id: Option<ID>`）
- SoulAssets 与 Skills 同构，复用 event parsing、mirror、repository 模式
- ContentAccessList 独立于 grant 体系，不受 ownership_epoch 影响
- 适配器脚本保持极简（单文件 Node.js，零依赖）
- AgentMonitor 对已安装 hook 的 agent 跳过 JSONL 日志监听，避免事件重复
- Soul 抽取只提取统计和风格特征，不上传原始对话内容
- 所有链上操作 DB 同步走 post-TX direct write 模式

## Acceptance Criteria

### Phase 1

1. Claude Code hook 安装后，悬浮窗口形象随 CLI 状态实时切换（idle / working / completed）
2. Codex hook 安装后，agent-turn-complete 反映在悬浮窗口
3. **AgentMonitor 无 hook 检测**：未安装 hook 时，通过进程探测 + JSONL 日志解析仍可感知 agent 状态
4. **多 agent 并行**：同时运行多个 CLI（如 Claude Code + Codex）时，事件正确聚合，mood 反映最高优先级状态
5. FloatingBall 渲染乌萨奇 sprite 动画（不是 emoji）
6. 无 CLI session 时 fallback 到后端 emotion
7. 7 个 Web Desktop API 端点可用且有相关测试
8. Agent 钱包首次启动自动生成，地址显示在 MainWindow settings

### Phase 2

9. 从 marketplace 浏览并下载 sprite sheet 格式的 Soul 形象到桌面端
10. 创作者上传形象资产到 SoulAssets（public 或 private）
11. 买家通过 purchase_content_access 付款后可解密下载 private 形象
12. creator/owner 可通过 add_access 手动添加到 ContentAccessList
13. Soul owner 给桌面 agent 地址 issue grant 后，agent 可访问 Soul 内容
14. **Soul 抽取**：从本地 Claude Code / Codex 对话日志提取人格特征，生成 SoulProfile，引导铸造上链

### 通用

15. `sui move test --path move/soulidity` 通过
16. `pnpm --dir desktop typecheck` 通过
17. `pnpm --dir desktop build` 通过
18. `npm test` 相关测试通过
19. `npm --prefix web run typecheck` 通过
20. `npm --prefix web run build` 通过

---

## Implementation Status

### Phase 1 — Implemented Foundations

- [x] Desktop-Claw fork + Soulidity branding
- [x] `desktop/packages/shared/src/types/cli-status.ts`
- [x] `desktop/apps/desktop/src/main/status-watcher.ts`
- [x] `desktop/apps/desktop/resources/hooks/soulidity-claude-hook.cjs`
- [x] `desktop/apps/desktop/resources/hooks/soulidity-codex-hook.cjs`
- [x] 默认 persona 资源（乌萨奇 sprite bundle）
- [x] `desktop/apps/desktop/src/renderer/components/SpriteRenderer.tsx`
- [x] `desktop/apps/desktop/src/renderer/hooks/useCliStatus.ts`
- [x] `FloatingBall` 已接入 sprite + CLI status 驱动
- [x] Web Desktop API：profile / catalog / device start / poll / complete
- [x] Desktop 相关测试文件：`desktop-catalog-repository`、`desktop-catalog-routes`、`desktop-device-routes`、`desktop-device-session`、`desktop-profile-routes`、`desktop-profile-service`
- [x] CI/CD release workflow（`.github/workflows/desktop-release.yml`）

### Phase 1 — Partial / Not Closed

- [ ] `keytar` 私钥存储未接入；当前仍有临时 JSON 落盘偏差
- [ ] Agent 钱包地址尚未在目标 MainWindow settings 中展示
- [ ] MainWindow（library / market / settings / agent 管理）未落地
- [ ] `soulidity-opencode-plugin.ts`
- [ ] `desktop/apps/desktop/src/main/agent-monitor.ts`
- [ ] `desktop/apps/desktop/src/renderer/hooks/useMoodResolver.ts`
- [ ] hooks + monitor 合并事件流 / installed hook 排除逻辑

### Phase 1 — Drift To Remove

- [ ] `ChatPanel` / `QuickInput` / `useClawSocket` 本地对话链路
- [ ] `SettingsPanel` 中的 LLM API Key / model 配置入口
- [ ] 当前 `FloatingBall + ChatPanel + SettingsPanel` 三视图/三窗口结构
- [ ] 4 态 emotion fallback 作为悬浮状态主驱动

### Phase 2 — Already Landed In Move / Web Layer

- [x] Move contracts：`move/soulidity/sources/assets.move`, `content_access.move`
- [x] Prisma schema：`SoulAssetVersionRecord`, `ContentAccessRecord`
- [x] Mirror functions：`web/lib/soulidity/mirror/upsert-asset.ts`, `upsert-content-access.ts`
- [x] Event extraction：asset append / asset delete / content access created
- [x] TX builders：`web/lib/soulidity/tx/content-access.ts`, `publish.ts`
- [x] API routes：assets, access-list, human + agent access
- [x] Seal crypto：`generateAssetDocumentIdForVersion`
- [x] Move protocol tests：SoulAssets + ContentAccessList

### Phase 2 — Desktop Consumption Still Pending

- [ ] Soul metadata parsing + desktop download flow
- [ ] 账号绑定（desktop agent → web account）
- [ ] Soul extraction：local session scanner
- [ ] Soul extraction：profile analyzer
- [ ] Soul extraction：mint flow UI

---

## Reference

- [Desktop-Claw](https://github.com/DjTaNg-404/Desktop-Claw) — Electron companion shell 上游
- [Confirmo](https://confirmo.app) — 桌面宠物参考：12 mood 系统、AgentMonitor 双层检测、JSONL 日志解析、celebrate 编排
- `desktop/docs/` — Desktop-Claw 上游产品策略和情绪设计文档
