# Phase 1.5: Desktop Companion — 被动检测 + Mood 升级 + 双窗口 + keytar

## Context

Phase 1 已完成：hooks 主动上报 + 4 态 emotion + sprite 渲染全链路可用。Phase 1.5 全部 5 项验收目标：

| # | 验收项 | 模块 |
|---|--------|------|
| 7 | AgentMonitor 无 hook 检测 | A |
| 8 | 多 agent 并行聚合 | A |
| 9 | 12 mood 替代 4 emotion | B |
| 10 | MainWindow + OverlayWindow 双窗口 | C |
| 11 | keytar 私钥存储 | D |

---

## Module A: AgentMonitor 被动检测 (验收 #7 + #8)

### 目标

未安装 hook 时，通过进程探测 + JSONL 日志监听感知 CLI 运行状态。多 CLI 并行时事件正确聚合。

### 设计

#### 1. ProcessProbe — 进程探测

- 定时 `pgrep -af` 扫描已知 CLI 进程名（`claude`, `codex`, `opencode`）
- 扫描间隔：5 秒
- 输出：`Map<clientType, { pid, running, cwd? }>`
- 进程消失 → 标记 session ended

#### 2. LogWatcher — JSONL 日志监听（增强层）

- Claude Code 会话日志路径：`~/.claude/projects/*/conversations/*.jsonl`
- `fs.watch` 监听目录变化，检测文件 append
- 从最新日志行推断粒度状态（tool use → working, assistant stop → completed）
- Codex / OpenCode 日志格式待确认，Phase 1.5 先做 Claude Code

#### 3. HookDetector — Hook 安装检测

- 读取 `~/.claude/settings.json`，检查 hooks 配置中是否包含 `soulidity` 关键字
- 已安装 hook → 该 clientType 优先用 hooks 事件，monitor 不写入
- 未安装 → monitor 写入 `~/.soulidity/agent-status.json`（与 hook 格式一致）

#### 4. 事件流合并

```
Hooks 层 (status-watcher.ts)  ──┐
                                 ├─→ 统一 AgentStatusFile ──→ IPC broadcast
AgentMonitor (agent-monitor.ts) ─┘
```

- AgentMonitor 写入同一个 `agent-status.json`，session 标记 `source: 'monitor'`
- status-watcher 已有的 debounce + broadcast 机制不变
- 同一 clientType 同时有 hook 和 monitor session 时，hook 优先

### 文件清单

| 文件 | 动作 |
|------|------|
| `packages/shared/src/types/cli-status.ts` | 改：`AgentSession` 加 `source?: 'hook' \| 'monitor'`，`clientType` 加 `'opencode'` |
| `apps/desktop/src/main/agent-monitor.ts` | 新建：ProcessProbe + LogWatcher + HookDetector |
| `apps/desktop/src/main/status-watcher.ts` | 改：hook/monitor session 去重 |
| `apps/desktop/src/main/index.ts` | 改：启动/停止 AgentMonitor |

### 验收

- [ ] 无 hook 时启动 Claude Code → 悬浮窗口 5s 内从 idle 变为 working
- [ ] Claude Code 退出 → 悬浮窗口回到 idle
- [ ] 安装 hook 后 → monitor 不再写入该 clientType session
- [ ] 同时运行 Claude Code + Codex → 两个 session 正确聚合，显示最高优先级状态

---

## Module B: 12 Mood 系统 (验收 #9)

### 目标

用 12 种 Mood 替代 4 态 Emotion。保留当前 6 sprite 动画槽（多 mood 共用），通过 CSS halo + 话术 + 行为差异化 12 mood 的体感区分。

### 12 Mood 定义

| Mood | 语义 | → Sprite 动画 | → CSS Halo |
|------|------|---------------|------------|
| idle | 空闲待机 | idle | idle |
| happy | 开心 | completed | happy |
| love | 喜爱/长期陪伴 | idle | love |
| excited | 兴奋/新任务 | thinking | excited |
| celebrate | 庆祝/里程碑 | completed | celebrate |
| sleepy | 犯困 | idle | sleepy |
| snoring | 熟睡 | error | snoring |
| working | 工作中 | working | working |
| angry | 生气/错误 | error | angry |
| surprised | 惊讶 | needs-attention | surprised |
| shy | 害羞/首次互动 | idle | shy |
| dragging | 被拖拽中 | idle | dragging |

### MoodResolver 推导规则（优先级降序）

| # | 条件 | → Mood |
|---|------|--------|
| 1 | isDragging | dragging |
| 2 | cliStatus = error | angry |
| 3 | cliStatus = needs-attention | surprised |
| 4 | cliStatus = working | working |
| 5 | cliStatus = thinking | excited |
| 6 | cliStatus = completed + consecutiveCompletions >= 3 | celebrate |
| 7 | cliStatus = completed | happy |
| 8 | 23:00-05:00 | snoring |
| 9 | 22:00-23:00 或 05:00-06:00 | sleepy |
| 10 | isFirstInteractionToday + 最近 2min 内 | shy |
| 11 | todayInteractionCount >= 10 + CLI idle + 静默 5-15min | love |
| 12 | 兜底 | idle |

### 新类型

```typescript
export type Mood = 'idle' | 'happy' | 'love' | 'excited' | 'celebrate'
  | 'sleepy' | 'snoring' | 'working' | 'angry' | 'surprised' | 'shy' | 'dragging'

export interface MoodSnapshot {
  mood: Mood
  reason: string
  updatedAt: string
  phrases: string[]
  intensity: number
  ambientLevel: 'low' | 'medium' | 'high'
  spriteAnimation: string   // 映射后的 sprite 动画名
}
```

### CSS Halo 12 Mood

| Mood | 周期 | 幅度 |
|------|------|------|
| idle | 5s | 1.008 |
| happy | 3s | 1.04 |
| love | 7s | 1.02 |
| excited | 1.8s | 1.05 |
| celebrate | 1.5s | 1.06 |
| sleepy | 8s | 1.005 |
| snoring | 10s | 1.003 |
| working | 2.2s | 1.06 |
| angry | 1.5s | 1.03 |
| surprised | 0.8s×3 pause | 1.04 |
| shy | 4s | 1.01 |
| dragging | none | 0.92 (缩小静止) |

### drag 状态

前端本地 override，不走后端。FloatingBall 拖拽时直接 override mood 为 `dragging`。

### 文件清单

| 文件 | 动作 |
|------|------|
| `packages/shared/src/types/emotion.ts` | 改：新增 `Mood` / `MoodSnapshot` 类型，保留 `EmotionState` 过渡 |
| `packages/backend/src/memory/emotion.ts` → `mood.ts` | 改：`deriveEmotionState` → `resolveMood`，12 mood 话术池 |
| `packages/backend/src/memory/emotion-service.ts` → `mood-service.ts` | 改：输出 `MoodSnapshot` |
| `packages/backend/src/gateway/emotion.ts` | 改：`GET /emotion` 返回 `MoodSnapshot`（超集兼容） |
| `apps/desktop/src/renderer/hooks/useClawEmotion.ts` → `useMood.ts` | 改：消费 `MoodSnapshot` |
| `apps/desktop/src/renderer/hooks/useMoodResolver.ts` | 新建：drag 状态注入 |
| `apps/desktop/src/renderer/components/FloatingBall/index.tsx` | 改：mood 驱动 sprite + halo + 话术 |
| `apps/desktop/src/renderer/components/FloatingBall/styles.css` | 改：12 mood halo 动画 |

### 验收

- [ ] CLI working → mood = working，sprite working，halo working
- [ ] CLI completed → mood = happy
- [ ] 连续完成 3 次 → mood = celebrate
- [ ] 23:00+ → mood = snoring
- [ ] 拖拽中 → mood = dragging，halo 缩小静止
- [ ] 点击气泡文案随 mood 变化

---

## Module C: MainWindow + OverlayWindow 双窗口 (验收 #10)

### 目标

现有双窗口（FloatingBall + SettingsPanel）升级为：OverlayWindow（精简悬浮层）+ MainWindow（完整管理面板）。

### 窗口职责

| 窗口 | 内容 | 特性 |
|------|------|------|
| OverlayWindow | sprite 动画 + 气泡 + 右键菜单 | 透明, frameless, alwaysOnTop, 点击穿透 |
| MainWindow | 多 tab 管理面板 | 有边框, 可调大小, 标题栏拖拽 |

OverlayWindow = 当前 ballWin，逻辑不变。
MainWindow = 替代当前 settingsWin，扩展为多 tab。

### MainWindow Tab 结构

| Tab | 内容 | 来源 |
|-----|------|------|
| Settings | Agent wallet 显示 + 密钥存储状态 + CLI status | 当前 SettingsPanel 扩展 |
| Library | 本地已下载 persona 列表 + active persona 切换 | 新建，Phase 2 对接市场 |
| Agent | 多 CLI session 详情 + monitor 状态 | 新建，消费 AgentMonitor |

> Market tab 留给 Phase 2（需要账号绑定 + 链上交互）。

### 实现方案

- `App.tsx` 路由：`?view=main` → MainWindow，`?view=overlay` → FloatingBall（默认）
- MainWindow 组件：`MainWindow/index.tsx`，内含 TabBar + 各 tab panel
- SettingsPanel 内容迁入 MainWindow Settings tab（组件复用，不重写）
- 右键菜单 "Settings" → 打开/聚焦 MainWindow

### 文件清单

| 文件 | 动作 |
|------|------|
| `apps/desktop/src/renderer/components/MainWindow/index.tsx` | 新建 |
| `apps/desktop/src/renderer/components/MainWindow/styles.css` | 新建 |
| `apps/desktop/src/renderer/components/MainWindow/SettingsTab.tsx` | 新建：从 SettingsPanel 提取 |
| `apps/desktop/src/renderer/components/MainWindow/LibraryTab.tsx` | 新建：本地 persona 列表（Phase 1.5 为空态 + 默认 persona） |
| `apps/desktop/src/renderer/components/MainWindow/AgentTab.tsx` | 新建：多 session 详情面板 |
| `apps/desktop/src/renderer/App.tsx` | 改：加 `main` view 路由 |
| `apps/desktop/src/main/index.ts` | 改：settingsWin → mainWin 创建逻辑（更大尺寸，可调大小） |
| `apps/desktop/src/renderer/components/SettingsPanel/` | 删除（迁入 MainWindow） |

### MainWindow 窗口参数

```
宽: 480, 高: 600
可调大小: true (min 400x500)
frame: false (自定义标题栏)
transparent: false
alwaysOnTop: false (非悬浮)
```

### 验收

- [ ] 右键菜单 → "Settings" → 打开 MainWindow
- [ ] MainWindow 有 Settings / Library / Agent 三个 tab
- [ ] Settings tab 显示 agent wallet 地址 + CLI status
- [ ] Agent tab 显示所有活跃 CLI session
- [ ] Library tab 显示默认 persona（乌萨奇）
- [ ] MainWindow 关闭后 OverlayWindow 仍正常运行

---

## Module D: keytar 私钥存储 (验收 #11)

### 目标

将 agent 私钥从 JSON 文件迁移到 OS keychain（macOS Keychain / Windows Credential Manager）。

### 当前实现

`agent-wallet.ts`:
- `agent_keypair.json` — 公开元数据（address, publicKey, createdAt）
- `agent_secret.json` — 私钥 hex（**明文落盘**）

### 迁移方案

```
启动时:
1. 尝试从 keytar 读取私钥
2. 若无 → 检查 agent_secret.json 是否存在
   2a. 存在 → 迁移到 keytar → 删除 agent_secret.json
   2b. 不存在 → 生成新 keypair → 存 keytar
3. agent_keypair.json 保留（公开元数据，无安全风险）
```

### keytar 接口

```typescript
// service: 'com.soulidity.desktop'
// account: 'agent-secret-key'
import keytar from 'keytar'

await keytar.setPassword('com.soulidity.desktop', 'agent-secret-key', secretKeyHex)
const secret = await keytar.getPassword('com.soulidity.desktop', 'agent-secret-key')
```

### 注意

- `keytar` 是 native addon，需要 `electron-rebuild` 或 `@electron/rebuild`
- `electron-builder` 需配置 native 依赖 rebuild
- macOS 首次访问 Keychain 可能弹授权对话框

### 文件清单

| 文件 | 动作 |
|------|------|
| `apps/desktop/package.json` | 改：加 `keytar` 依赖 |
| `apps/desktop/src/main/agent-wallet.ts` | 改：keytar 读写 + JSON 迁移 + 删除旧 secret 文件 |
| `apps/desktop/electron-builder` 配置 | 改：确保 native addon rebuild |

### 验收

- [ ] 首次安装：keypair 生成 → 私钥存入 OS keychain，无 `agent_secret.json` 文件
- [ ] 从 Phase 1 升级：自动迁移旧 JSON 私钥到 keychain，旧文件删除
- [ ] SettingsPanel 地址显示正常
- [ ] `pnpm --dir desktop build` 通过（native addon 正确编译）

---

## 实施顺序

```
Step 1: 共享类型层
  - cli-status.ts: source / opencode
  - emotion.ts: Mood / MoodSnapshot

Step 2: AgentMonitor (Module A) — 独立
  - agent-monitor.ts
  - status-watcher.ts 去重
  - index.ts 接入

Step 3: Mood 后端 (Module B 后端) — 独立，可与 Step 2 并行
  - mood.ts (从 emotion.ts 演化)
  - mood-service.ts (从 emotion-service.ts 演化)
  - gateway 路由

Step 4: keytar (Module D) — 独立，可与 Step 2/3 并行
  - 加依赖 + rebuild 配置
  - agent-wallet.ts 改造 + 迁移逻辑

Step 5: Mood 前端 (Module B 前端)
  - useMood.ts / useMoodResolver.ts
  - FloatingBall 改造
  - CSS halo 12 mood

Step 6: MainWindow (Module C) — 依赖 Step 2 (AgentTab) + Step 5 (mood)
  - MainWindow 组件
  - SettingsPanel 迁入
  - LibraryTab / AgentTab
  - index.ts 窗口管理改造
  - 删除旧 SettingsPanel

Step 7: 集成 + 清理
  - 旧 emotion 引用清理
  - typecheck / build
  - spec Implementation Status 更新
```

Step 2 / 3 / 4 互相独立，可并行。

---

## 验证

1. `pnpm --dir desktop typecheck` 通过
2. `pnpm --dir desktop build` 通过
3. 手动测试：无 hook 启动 CLI → 悬浮窗口响应
4. 手动测试：不同时段/状态下 mood 切换 + halo + 气泡
5. 手动测试：MainWindow 三 tab 正常
6. 手动测试：keytar 迁移 + 新装
7. Spec 验收 #7-#11 全部勾选
