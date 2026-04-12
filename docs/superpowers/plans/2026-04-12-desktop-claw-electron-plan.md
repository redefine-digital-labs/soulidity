# Desktop Companion — 基于 Desktop-Claw 改造计划

## Context

直接在 [Desktop-Claw](https://github.com/DjTaNg-404/Desktop-Claw) 代码基础上改造，而非从零搭建。Desktop-Claw 已经提供了：
- Electron 34 + React 18 + electron-vite + pnpm monorepo 完整骨架
- 透明悬浮窗口 + click-through + 拖拽 + 右键菜单
- WebSocket + Fastify 后端通信
- emotion 状态系统（idle/busy/done/night + CSS 动画）
- SOUL.md 人格系统 + 记忆系统
- electron-builder 打包 + GitHub Actions CI
- 设置面板（LLM 配置）

一期目标：在 Desktop-Claw 基础上增加 CLI 状态监听（Claude Code + Codex hooks）、默认 sprite sheet 形象、agent Ed25519 钱包，并适配为 Soulidity Desktop。

## 复用 vs 改造 vs 新增

| Desktop-Claw 组件 | 处理方式 | 说明 |
|-------------------|---------|------|
| Electron 骨架 + electron-vite | **复用** | 完整保留 |
| 透明悬浮窗口 + FloatingBall | **改造** | 把 56px CSS 球替换为 sprite sheet 角色 |
| emotion 系统 (idle/busy/done/night) | **改造** | 扩展到 6 状态（idle/thinking/working/needs-attention/completed/error） |
| IPC bridge + preload | **复用** | 完整保留 |
| 设置面板 (SettingsPanel) | **改造** | 增加 agent 钱包显示 |
| WebSocket + Fastify 后端 | **复用** | 保留架构，后续可接入 |
| SOUL.md 人格系统 | **复用** | 与 Soulidity 的 soul.md 五段式对齐 |
| 记忆系统 (memory/) | **复用** | 保留，一期不扩展 |
| AI agent loop | **复用** | 保留，一期不修改 |
| ChatPanel / ChatBubble | **复用** | 保留聊天功能 |
| LLM 配置 | **复用** | 已有完整配置 UI |
| 文件技能 (read/write/edit) | **复用** | 保留 |
| 右键菜单 + 拖拽 | **复用** | 完整保留 |
| — | **新增** | CLI 状态文件监听 (status-watcher) |
| — | **新增** | Claude Code hook 适配器 |
| — | **新增** | Codex hook 适配器 |
| — | **新增** | Sprite sheet 渲染器 |
| — | **新增** | 默认 sprite sheet 形象资产 |
| — | **新增** | Agent Ed25519 钱包 |
| — | **新增** | 品牌适配（名称、图标、协议改为 soulidity） |

## 目录结构变更

在 Desktop-Claw 现有结构上的增量：

```
desktop/                                # (原 Desktop-Claw 根目录)
├── apps/desktop/
│   ├── src/
│   │   ├── main/
│   │   │   ├── index.ts               # 修改：增加 status-watcher 启动
│   │   │   ├── status-watcher.ts      # 新增：fs.watch ~/.soulidity/agent-status.json
│   │   │   └── agent-wallet.ts        # 新增：Ed25519 keypair (tweetnacl)
│   │   ├── preload/
│   │   │   └── index.ts               # 修改：增加 status + wallet IPC
│   │   └── renderer/
│   │       ├── components/
│   │       │   ├── FloatingBall/       # 修改：替换 CSS 球为 sprite 角色
│   │       │   │   ├── SpriteRenderer.tsx  # 新增：Canvas sprite sheet 渲染
│   │       │   │   └── index.tsx       # 修改：使用 SpriteRenderer
│   │       │   ├── AgentWallet/        # 新增：agent 地址展示组件
│   │       │   └── ...existing...
│   │       ├── hooks/
│   │       │   ├── useClawEmotion.ts   # 修改：扩展到 6 状态
│   │       │   ├── useCliStatus.ts     # 新增：订阅 agent-status-changed
│   │       │   └── ...existing...
│   │       └── ...existing...
│   ├── resources/
│   │   ├── hooks/                      # 新增
│   │   │   ├── soulidity-claude-hook.js
│   │   │   └── soulidity-codex-hook.js
│   │   ├── default-persona/            # 新增
│   │   │   ├── sprite-config.json
│   │   │   └── sheet.png
│   │   └── persona/                    # 现有：SOUL.md 等
│   └── electron.vite.config.ts         # 保持不变
│
├── packages/
│   ├── backend/                        # 现有：保留不动
│   ├── shared/
│   │   └── src/types/
│   │       ├── emotion.ts              # 修改：扩展情绪类型
│   │       └── cli-status.ts           # 新增：CLI 状态类型定义
│   └── ...existing...
│
└── package.json                        # 修改：名称、appId
```

## 任务分解

### Task 1: Fork Desktop-Claw 到 desktop/

- 克隆 Desktop-Claw 到 `desktop/` 目录
- 修改 `package.json`：名称改为 `soulidity-desktop`，appId 改为 `com.openclaw.soulidity.desktop`
- 修改打包配置中的应用名、图标路径、deep-link 协议（`soulidity://`）
- 验证 `pnpm install && pnpm run dev` 能正常启动

### Task 2: CLI 状态类型定义

**新增文件：**
- `packages/shared/src/types/cli-status.ts`

```typescript
export type CliAgentStatus = 'idle' | 'thinking' | 'working' | 'needs-attention' | 'completed' | 'error'

export interface AgentSession {
  sessionId: string
  clientType: 'claude-code' | 'codex' | 'custom'
  status: CliAgentStatus
  sessionTitle?: string
  currentAction?: { tool?: string; details?: string; timestamp: number }
  needsAttention?: string
  startedAt: number
  lastUpdated: number
  endedAt?: number
}

export interface AgentStatusFile {
  version: 1
  lastUpdated: number
  sessions: Record<string, AgentSession>
}
```

**修改文件：**
- `packages/shared/src/types/emotion.ts` — 扩展 EmotionState 加入新状态或保持映射

### Task 3: CLI 状态文件监听器

**新增文件：**
- `apps/desktop/src/main/status-watcher.ts`

```typescript
import { watch, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { BrowserWindow } from 'electron'
import type { AgentStatusFile, CliAgentStatus } from '@desktop-claw/shared'

const STATUS_DIR = join(homedir(), '.soulidity')
const STATUS_FILE = join(STATUS_DIR, 'agent-status.json')

export function setupStatusWatcher(windows: { ball?: BrowserWindow }) {
  if (!existsSync(STATUS_DIR)) mkdirSync(STATUS_DIR, { recursive: true })

  let debounceTimer: NodeJS.Timeout | null = null

  const watcher = watch(STATUS_DIR, (eventType, filename) => {
    if (filename !== 'agent-status.json') return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      try {
        const content = readFileSync(STATUS_FILE, 'utf-8')
        const status: AgentStatusFile = JSON.parse(content)
        const aggregate = resolveAggregateStatus(status)
        windows.ball?.webContents.send('agent-status-changed', aggregate)
      } catch {}
    }, 100)
  })

  return () => watcher.close()
}

function resolveAggregateStatus(file: AgentStatusFile): CliAgentStatus {
  const sessions = Object.values(file.sessions)
    .filter(s => !s.endedAt)
    .sort((a, b) => b.lastUpdated - a.lastUpdated)
  return (sessions[0]?.status as CliAgentStatus) ?? 'idle'
}
```

**修改文件：**
- `apps/desktop/src/main/index.ts` — 在 app.whenReady 中调用 `setupStatusWatcher({ ball: ballWindow })`
- `apps/desktop/src/preload/index.ts` — 增加 `onAgentStatusChanged` 订阅

### Task 4: Claude Code Hook 适配器

**新增文件：**
- `apps/desktop/resources/hooks/soulidity-claude-hook.js`

单文件 Node.js 脚本（零依赖），通过 stdin 接收 Claude Code hook JSON，原子写入 `~/.soulidity/agent-status.json`。

处理 6 种事件：
- `SessionStart` → idle
- `UserPromptSubmit` → working
- `PreToolUse` → working + currentAction 详情
- `PostToolUse` → 清除 currentAction
- `Stop` → completed
- `SessionEnd` → idle

参考 `/Applications/Confirmo.app/Contents/Resources/confirmo-hook.js` 的实现模式。

### Task 5: Codex Hook 适配器

**新增文件：**
- `apps/desktop/resources/hooks/soulidity-codex-hook.js`

通过命令行参数接收 JSON，处理 `agent-turn-complete` 事件，支持转发到用户原有 notify 命令。

参考 `/Applications/Confirmo.app/Contents/Resources/confirmo-codex-hook.js`。

### Task 6: Sprite Sheet 渲染器

**新增文件：**
- `apps/desktop/src/renderer/components/FloatingBall/SpriteRenderer.tsx`

Canvas API 实现，接收 `SpriteSheetConfig` + 当前状态名，用 `requestAnimationFrame` 逐帧绘制。

```typescript
interface SpriteSheetConfig {
  src: string           // sprite sheet 图片路径
  frameWidth: number
  frameHeight: number
  columns: number
  animations: Record<string, {
    frames: number[]
    fps: number
    loop: boolean
  }>
}
```

**修改文件：**
- `apps/desktop/src/renderer/components/FloatingBall/index.tsx` — 条件渲染：有 sprite config 时用 SpriteRenderer，否则保留原 CSS 球

### Task 7: 默认 Sprite Sheet 资产

**新增文件：**
- `apps/desktop/resources/default-persona/sprite-config.json`
- `apps/desktop/resources/default-persona/sheet.png`

从公开素材制作 6 状态动画的 sprite sheet。如果无合适素材，用简笔画占位（后续替换）。

每个状态至少 2-4 帧：idle（呼吸）、thinking（挠头）、working（打字）、needs-attention（跳动）、completed（庆祝）、error（沮丧）。

### Task 8: 状态 → emotion 桥接

**新增文件：**
- `apps/desktop/src/renderer/hooks/useCliStatus.ts`

```typescript
export function useCliStatus() {
  const [status, setStatus] = useState<CliAgentStatus>('idle')

  useEffect(() => {
    const unsubscribe = window.electronAPI.onAgentStatusChanged((newStatus) => {
      setStatus(newStatus)
    })
    return unsubscribe
  }, [])

  return status
}
```

**修改文件：**
- `apps/desktop/src/renderer/hooks/useClawEmotion.ts` — CLI status 变化时同步更新 emotion 状态
- Desktop-Claw 的 emotion 映射：CLI `working` → emotion `busy`，CLI `completed` → emotion `done`，CLI `idle` → emotion `idle`

### Task 9: Agent Ed25519 钱包

**新增文件：**
- `apps/desktop/src/main/agent-wallet.ts`

用 `tweetnacl` 生成 Ed25519 keypair，Sui 地址 = SHA-256(0x00 || publicKey) 前 32 字节 hex。存入 Desktop-Claw 现有的 config 系统（`data/config.json`）。

**新增依赖：**
- `tweetnacl` → `packages/backend/package.json` 或 `apps/desktop/package.json`

**IPC handlers：**
- `generate-agent-keypair` — 首次生成，后续返回已有
- `load-agent-keypair` — 读取

**修改文件：**
- `apps/desktop/src/main/index.ts` — 注册 IPC handlers
- `apps/desktop/src/preload/index.ts` — 暴露 API

### Task 10: Agent 钱包 UI

**新增文件：**
- `apps/desktop/src/renderer/components/AgentWallet/index.tsx`

在 SettingsPanel 中新增一个 tab 或区域，显示：
- Agent Sui 地址（可复制）
- 公钥 hex
- "首次启动时自动生成" 提示

**修改文件：**
- `apps/desktop/src/renderer/components/SettingsPanel/index.tsx` — 加入 AgentWallet 组件

### Task 11: 品牌适配

**修改文件：**
- `apps/desktop/package.json` — name, productName, appId
- `apps/desktop/electron.vite.config.ts` — 如需要
- `apps/desktop/resources/icon.*` — 替换为 Soulidity 图标（可暂用占位图标）
- `packages/backend/src/paths.ts` — 数据目录名改为 `Soulidity-Desktop`
- `apps/desktop/resources/persona/SOUL.md` — 替换为 Soulidity 角色人格描述

### Task 12: 打包 + 验证

**修改文件：**
- `apps/desktop/package.json` build 字段 — 更新 appId、productName、protocols

**验证步骤：**
1. `cd desktop && pnpm install && pnpm run dev` → 透明悬浮窗口显示 sprite 形象
2. 手动写入 `~/.soulidity/agent-status.json` → 形象切换动画
3. 安装 Claude Code hook → 真实 CLI 状态驱动
4. 右键菜单 → 打开设置 → 看到 Agent 钱包地址
5. `pnpm run build` → 打包成功

## 关键依赖文件

- Desktop-Claw `apps/desktop/src/main/index.ts` — 窗口创建和 IPC 注册入口
- Desktop-Claw `apps/desktop/src/preload/index.ts` — contextBridge API 定义
- Desktop-Claw `apps/desktop/src/renderer/components/FloatingBall/index.tsx` — 悬浮球渲染，需改造为 sprite
- Desktop-Claw `packages/shared/src/types/emotion.ts` — emotion 类型定义，需扩展
- Desktop-Claw `packages/backend/src/memory/emotion-service.ts` — emotion 状态机
- Confirmo `confirmo-hook.js` — Claude Code hook 参考实现（`/Applications/Confirmo.app/Contents/Resources/`）
- Confirmo `confirmo-codex-hook.js` — Codex hook 参考实现
