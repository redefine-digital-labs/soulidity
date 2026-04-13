# Desktop Companion — Soulidity Desktop Persona Manager

---

## Goal

构建桌面形象管理应用，将 Soulidity Soul 生态延伸到桌面端。核心能力：根据 LLM CLI（Claude Code / Codex）的运行状态实时切换桌面形象动画，形象资产从 Soul 市场下载并通过链上访问控制保护，桌面端自带 Sui agent 地址参与 Soul 交互。

## Scope

### Phase 1 — Companion Shell（当前执行目标）

1. **统一状态协议** — `~/.soulidity/agent-status.json` 文件监听 + Claude Code / Codex 适配器
2. **悬浮球 Electron 应用** — FloatingBall 透明悬浮窗口 + SettingsPanel 设置窗口
3. **Sprite Sheet 渲染** — Canvas API 逐帧动画，接入本地默认 persona 和 CLI 状态驱动
4. **桌面 Agent 钱包** — 每设备一个 Ed25519 agent 地址，显示于 SettingsPanel
5. **情绪系统（基础）** — 4 态 emotion（idle/busy/done/night）+ CLI 6 态映射，后端 LLM 生成互动语

### Phase 1.5 — 被动检测与 Mood 升级（未开始）

1. **AgentMonitor 被动检测** — 进程探测（pgrep）+ JSONL 会话日志监听，无 hook 也能感知 CLI 状态
2. **12 Mood 系统** — CLI 6 态 + 上下文规则映射，替代当前 4 emotion
3. **双窗口模型** — MainWindow（library / market / settings / agent 管理）+ OverlayWindow
4. **OpenCode 适配器** — `soulidity-opencode-plugin.ts`

### Phase 2 — Soul Integration

1. **Soul Meta 扩展** — `metadata_ref` 指向 JSON，声明形象格式、状态映射、资产引用
2. **SoulAssets 内容层** — Move 模块，与 Skills 同构（`Table<String, vector<AssetSlot>>`）
3. **ContentAccessList** — Move 模块，独立于 grant 的内容访问权售卖机制
4. **账号与内容联动** — Privy 钱包 + 桌面 agent 地址绑定、市场下载、受保护内容访问
5. **Soul 抽取铸造** — 从本地 LLM 对话日志提取人格特征，引导用户铸造 Soul

### 不做（预留）

- Live2D 高级渲染格式
- 语音系统（预录音频 + TTS 实时合成）
- 桌面端聊天面板 / LLM 对话能力 / LLM Key 配置（已清理）

---

## Locked Decisions

| 决策 | 结论 | 原因 |
|------|------|------|
| 桌面运行时 | Electron（Desktop-Claw fork） | 不保留 Tauri 并行方案 |
| 钱包存储 | 当前 JSON（Phase 1），目标 keytar（Phase 1.5） | Phase 1 暂用 JSON，后续迁移 OS keychain |
| 地址推导 | `keypair.toSuiAddress()` / Sui SDK 语义 | 不手写 SHA-256/blake2b |
| 状态协议 | 6 态文件协议 `~/.soulidity/agent-status.json` | 统一 CLI 适配 |
| 检测策略 | Phase 1 仅 Hooks 主动上报；Phase 1.5 追加 AgentMonitor 被动检测 | 分阶段交付 |
| 情绪系统 | Phase 1: 4 态 emotion + CLI 6 态映射；Phase 1.5: 12 mood | 分阶段交付 |
| Sprite 渲染 | 原生 Canvas API + requestAnimationFrame | 不引入 Phaser/Pixi |
| 依赖位置 | Phase 1 所有桌面依赖放 `apps/desktop/package.json` | 不放 `packages/backend` |

---

## Architecture

### Tech Stack

Electron, React, electron-vite, pnpm workspace, Node `fs.watch`, Canvas API, `@mysten/sui`, Fastify（内嵌后端）

### Workspace Layout

```
desktop/                          # Desktop-Claw-based pnpm workspace
├── apps/desktop/
│   ├── src/main/                 # Electron main process
│   │   ├── index.ts              # lifecycle, IPC, window management
│   │   ├── status-watcher.ts     # ~/.soulidity/ file watcher (hooks 层)
│   │   └── agent-wallet.ts       # Ed25519 keypair management
│   ├── src/preload/              # IPC bridge
│   ├── src/renderer/
│   │   ├── components/
│   │   │   ├── FloatingBall/     # overlay sprite + bubbles + interaction
│   │   │   ├── ChatBubble/       # speech bubble with fade animation
│   │   │   ├── SettingsPanel/    # agent wallet display + CLI status
│   │   │   └── SpriteRenderer.tsx # Canvas sprite sheet animation
│   │   ├── hooks/
│   │   │   ├── useCliStatus.ts   # CLI status subscription (hooks 层)
│   │   │   └── useClawEmotion.ts # backend emotion polling
│   │   └── lib/
│   │       └── backend-client.ts # HTTP fetch wrapper
│   └── resources/
│       ├── hooks/                # CLI adapter scripts
│       └── default-persona/      # bundled sprite assets
├── packages/backend/             # Desktop-Claw backend (Fastify)
│   └── src/
│       ├── gateway/
│       │   ├── emotion.ts        # GET /emotion, POST /emotion/interact
│       │   └── persona.ts        # GET /persona, GET /greeting
│       ├── memory/               # emotion service, greeting service, memory persistence
│       ├── llm/                  # LLM client (greeting/memory 用)
│       └── security/             # request auth, allowed roots
└── packages/shared/              # shared types
    └── src/types/
        ├── cli-status.ts         # canonical status protocol types
        └── emotion.ts            # EmotionState, EmotionSnapshot
```

### Window Model

```
Electron Main Process
├── window lifecycle (FloatingBall + SettingsPanel)
├── status watcher (hooks 层)
├── wallet IPC
└── config management

FloatingBall Window（透明悬浮 companion）
├── transparent, frameless, alwaysOnTop, skipTaskbar
├── 尺寸：200x230（含气泡区域）
├── 位置：记忆上次位置（config.json → ballPosition）
├── 内容：Canvas sprite 动画 + ChatBubble 气泡 + 右键菜单
└── 点击穿透：轮询光标位置，球区域内接收事件

SettingsPanel Window（设置面板）
├── agent wallet 地址显示（只读 + 复制）
└── CLI agent monitor 状态
```

### Interaction

| 操作 | 行为 |
|------|------|
| 拖拽 | 移动位置，松手保存 |
| 左键点击 | 弹出互动语气泡（LLM 预生成或 fallback） |
| 右键 | 上下文菜单：设置 / 退出 |
| 状态变化 | 切换 sprite 动画 + CSS halo 呼吸效果 |
| 无活跃 session | 显示 idle 动画 |

### Local Storage

```
data/                             # userData/data/ (prod) or desktop/data/ (dev)
├── config.json                   # ballPosition, general settings
├── persona/                      # SOUL.md, USER.md, CONTEXT.md
├── memory/                       # conversation archives, greeting cache
├── db/                           # local state
└── files/                        # user files

userData/state/
└── agent_keypair.json            # Ed25519 keypair (Phase 1: full key; Phase 1.5: public only + keytar)
```

---

## Module Specifications

### Module 1 — Hooks 主动上报层

**文件结构：**
```
~/.soulidity/
├── agent-status.json          # 当前唯一 source of truth（Electron watcher 监听）
└── sessions/
    └── {session_id}.json      # 预留：按 session 拆文件的扩展目录
```

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

**Electron 主进程侧（status-watcher.ts）：**
- watch `~/.soulidity/`，启动时先读一次当前状态
- debounce 后解析 JSON，广播 `agent-status-changed` 到所有窗口
- 容忍原子写入过程中的短暂半成品文件

### Module 2 — 情绪系统（当前实现）

**4 态 emotion + CLI 6 态映射：**

后端 `EmotionService` 维护 `EmotionSnapshot`（state, reason, phrases, intensity, ambient）。每 15 秒由 `useClawEmotion` hook 轮询。

| EmotionState | 触发条件 |
|---|---|
| idle | 默认 / 无活动 |
| busy | 收到用户消息 / 流式输出中 |
| done | 任务完成 |
| night | 深夜时段 |

**CLI 6 态 → Emotion 映射：**

| CLI Status | → Sprite Animation | → CSS Halo |
|---|---|---|
| idle | idle (emotion fallback) | idle / emotion |
| thinking | thinking | busy |
| working | working | busy |
| needs-attention | needs-attention | night |
| completed | completed | done |
| error | error | night |

规则：CLI status 非 idle 时直接驱动 sprite；CLI idle 时 fallback 到 emotion 映射。

**互动语：**
- 启动时按时段弹出问候气泡（morning / afternoon / evening / latenight）
- 空闲态每 6–15 分钟自动冒泡（从 snapshot.phrases 取）
- 点击弹出互动语（先调 `/greeting` 取 LLM 生成的，fallback 到本地按 emotion 的文案池）
- 用户关闭气泡后 3 分钟冷却

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

**SpriteRenderer：** React 组件，Canvas API 逐帧渲染。接收 `config`、`animation`（状态名）、`width`、`height`。

**默认 persona（乌萨奇）：** 4096x3584 PNG，8 列 x 7 行，512x512 帧，共 56 帧。

| 行 | 帧范围 | 动画名 |
|----|--------|--------|
| 0 | 0-7 | idle |
| 1 | 8-15 | thinking |
| 2 | 16-23 | working |
| 3 | 24-31 | needs-attention |
| 4 | 32-39 | completed |
| 5 | 40-47 | error |
| 6 | 48-55 | (reserved) |

CSS halo 通过 `data-emotion` 属性驱动呼吸动画（idle 5s / busy 2.2s / done 6s / night 8s）。

### Module 4 — Agent 钱包

```ts
interface AgentKeypairInfo {
  address: string     // Sui address (0x...)
  publicKey: string   // hex-encoded
  createdAt: number
}
```

- Sui SDK `toSuiAddress()` 推导地址
- Phase 1: 完整 keypair 存入 `userData/state/agent_keypair.json`
- Phase 1.5 目标: private key → OS keychain via `keytar`
- 每台设备一个 agent 地址
- SettingsPanel 显示地址（可复制）

### Module 5 — 内嵌后端（Fastify）

本地 Fastify 服务，由 Electron 主进程启动，端口 3721。

**当前路由：**

| 端点 | 方法 | 功能 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/persona` | GET | 返回 SOUL.md / USER.md / CONTEXT.md |
| `/greeting` | GET | 返回 LLM 预生成的互动语 |
| `/emotion` | GET | 返回当前 EmotionSnapshot |
| `/emotion/interact` | POST | 用户互动信号 |

**后端服务：**
- `EmotionService` — 情绪状态机，1 分钟 tick，跨小时边界检测
- `GreetingService` — LLM 预生成互动语池（8 条/次），低于 3 条时自动补充
- `MemoryService` — 对话归档、日级压缩、sealDay

**安全：**
- Bearer token 认证（每次启动随机生成）
- Origin 白名单（仅允许渲染进程源）

### Module 6 — Soul Metadata 扩展（Phase 2）

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

**桌面端下载流程：** 读 metadata_ref → 解析 persona → publicAssets 直接下载 / protectedAssets 按权限解密下载 → 存入本地。

### Module 7 — SoulAssets 内容层（Phase 2）

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

**API Routes：**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/souls/[id]/assets` | GET | 列出资产 |
| `/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/access` | GET | Human 访问 |
| `/api/agent/souls/[id]/assets/[assetName]/versions/[versionIndex]/access` | GET | Agent 访问 |
| `/api/souls/[id]/assets/append` | POST | 上传新版本 |
| `/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/delete` | POST | 软删除 |

### Module 8 — ContentAccessList（Phase 2）

独立于 grant 体系，不随 Soul 所有权转移失效。

```move
public struct ContentAccessList has key {
    id: UID,
    soul_id: ID,
    creator: address,
    entries: table::Table<address, ContentAccessEntry>,
    entry_count: u64,
}
```

**访问判定优先级：**
1. viewer 是 owner → `seal_approve_*_read_owner`
2. viewer 有 active grant → `seal_approve_*_read_granted_agent`
3. viewer 在 ContentAccessList → `seal_approve_*_allowlisted`
4. 均不满足 → 403

### Module 9 — 双钱包与 Agent 身份（Phase 2）

| 场景 | 钱包 |
|------|------|
| 购买 Soul / 内容 / 铸造 | Privy 钱包 |
| 接收 grant / 读写 memory/skills | Agent 地址 |
| 下载已购形象（allowlist） | Privy 钱包地址 |

**登录绑定：** 浏览器登录 → 桌面端上报 agent_address → `POST /api/desktop/me/agent` → 关联到 Member

### Module 10 — Soul 抽取铸造（Phase 2）

从本地 LLM 对话日志中提取人格特征，引导用户构建 Soul 并铸造上链。

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
  → 下载解密到本地 → 选择 active persona → 悬浮窗口展示
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
- Soul 抽取只提取统计和风格特征，不上传原始对话内容
- 所有链上操作 DB 同步走 post-TX direct write 模式

## Acceptance Criteria

### Phase 1

1. Claude Code hook 安装后，悬浮窗口形象随 CLI 状态实时切换（idle / working / completed）
2. Codex hook 安装后，agent-turn-complete 反映在悬浮窗口
3. FloatingBall 渲染乌萨奇 sprite 动画（不是 emoji）
4. 无 CLI session 时 fallback 到后端 emotion
5. 7 个 Web Desktop API 端点可用且有相关测试
6. Agent 钱包首次启动自动生成，地址显示在 SettingsPanel

### Phase 1.5

7. AgentMonitor 无 hook 检测：未安装 hook 时，通过进程探测 + JSONL 日志解析仍可感知 agent 状态
8. 多 agent 并行：同时运行多个 CLI（如 Claude Code + Codex）时，事件正确聚合
9. 12 mood 系统替代 4 emotion
10. MainWindow + OverlayWindow 双窗口模型
11. `keytar` 私钥存储

### Phase 2

12. 从 marketplace 浏览并下载 sprite sheet 格式的 Soul 形象到桌面端
13. 创作者上传形象资产到 SoulAssets（public 或 private）
14. 买家通过 purchase_content_access 付款后可解密下载 private 形象
15. creator/owner 可通过 add_access 手动添加到 ContentAccessList
16. Soul owner 给桌面 agent 地址 issue grant 后，agent 可访问 Soul 内容
17. Soul 抽取：从本地 Claude Code / Codex 对话日志提取人格特征，生成 SoulProfile，引导铸造上链

### 通用

18. `sui move test --path move/soulidity` 通过
19. `pnpm --dir desktop typecheck` 通过
20. `pnpm --dir desktop build` 通过
21. `npm test` 相关测试通过
22. `npm --prefix web run typecheck` 通过
23. `npm --prefix web run build` 通过

---

## Implementation Status

### Phase 1 — Complete

- [x] Desktop-Claw fork + Soulidity branding
- [x] `desktop/packages/shared/src/types/cli-status.ts`
- [x] `desktop/apps/desktop/src/main/status-watcher.ts`
- [x] `desktop/apps/desktop/resources/hooks/soulidity-claude-hook.cjs`
- [x] `desktop/apps/desktop/resources/hooks/soulidity-codex-hook.cjs`
- [x] 默认 persona 资源（乌萨奇 sprite bundle）
- [x] `SpriteRenderer.tsx` — Canvas sprite sheet 渲染
- [x] `useCliStatus.ts` — CLI status subscription
- [x] `useClawEmotion.ts` — Backend emotion polling
- [x] `FloatingBall` — sprite + CLI status + emotion + bubble + drag + context menu
- [x] `ChatBubble` — speech bubble with fade animation
- [x] `SettingsPanel` — agent wallet display + CLI status
- [x] `backend-client.ts` — HTTP fetch wrapper
- [x] Agent wallet（Ed25519 keypair, JSON storage）
- [x] 内嵌 Fastify 后端（emotion, persona, greeting routes）
- [x] Web Desktop API：profile / catalog / device start / poll / complete
- [x] Desktop 相关测试文件
- [x] CI/CD release workflow（`.github/workflows/desktop-release.yml`）

### Phase 1 — Drift Cleaned

以下代码已从仓库移除，不再扩展：

- [x] ~~ChatPanel / CalendarView / DayDetailView~~ — 删除
- [x] ~~QuickInput~~ — 删除
- [x] ~~ClawProfile~~ — 删除（仅 ChatPanel 使用）
- [x] ~~useClawSocket~~ — 删除
- [x] ~~llm-config.ts~~ — 删除（SettingsPanel 不再配置 LLM）
- [x] ~~gateway/ws.ts~~ — 删除（WebSocket 聊天）
- [x] ~~gateway/calendar.ts~~ — 删除（日历查询）
- [x] ~~task-coordinator/~~ — 删除（聊天任务队列）
- [x] ~~panel window creation~~ — 删除（三窗口 → 两窗口）
- [x] ~~QuickInput IPC~~ — 删除（toggle / reposition）
- [x] ~~file drop → panel IPC~~ — 删除

### Phase 1 — Known Gaps

- [ ] `keytar` 私钥存储未接入（JSON 落盘，可用但非目标态）
- [ ] Agent 钱包地址尚未从 SettingsPanel 链到 web 端账号绑定

### Phase 1.5 — Not Started

- [ ] `soulidity-opencode-plugin.ts`
- [ ] `desktop/apps/desktop/src/main/agent-monitor.ts`
- [ ] `desktop/apps/desktop/src/renderer/hooks/useMoodResolver.ts`
- [ ] hooks + monitor 合并事件流 / installed hook 排除逻辑
- [ ] MainWindow（library / market / settings / agent 管理）
- [ ] 12 mood 系统

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

## Dead Code（保留但未激活）

以下后端模块在聊天链路移除后不再有活跃调用路径，但仍保留在代码中。它们是 Desktop-Claw 上游的核心功能，Phase 1.5 或 Phase 2 可能复用：

- `agent/` — Agent reasoning loop, skill management, prompt assembly
- `memory/interpret-service.ts` — 对话 interpret buffer（`feedInterpretBuffer` 不再被调用，`flushInterpretBuffer` 在 sealDay 中为 no-op）
- `memory/capsule-compiler.ts` — 日记胶囊编译
- `llm/` — LLM client（仍被 greeting-service 和 memory-service 活跃使用）

---

## Reference

- [Desktop-Claw](https://github.com/DjTaNg-404/Desktop-Claw) — Electron companion shell 上游
- [Confirmo](https://confirmo.app) — 桌面宠物参考：12 mood 系统、AgentMonitor 双层检测、JSONL 日志解析、celebrate 编排
- `desktop/docs/` — Desktop-Claw 上游产品策略和情绪设计文档
