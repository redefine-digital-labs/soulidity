# Desktop Companion — Soulidity Desktop Persona Manager

## Goal

构建桌面形象管理应用，将 Soulidity Soul 生态延伸到桌面端。核心能力：根据 LLM CLI（Claude Code / Codex）的运行状态实时切换桌面形象动画，形象资产从 Soul 市场下载并通过链上访问控制保护，桌面端自带 Sui agent 地址参与 Soul 交互。

## Scope

当前执行路线是 **Electron + Desktop-Claw**。本 spec 继续描述桌面 companion 的完整产品目标，但执行上拆成两个阶段，避免再生成并行的 Tauri 文档链。

### Phase 1 — Companion Shell

1. **统一状态协议** — `~/.soulidity/agent-status.json` 文件监听 + Claude Code / Codex 适配器
2. **双窗口 Electron 应用** — 主窗口（library / market / settings / agent 管理）+ 可"放出"的透明悬浮窗口
3. **Sprite Sheet 渲染** — Canvas API 逐帧动画，先接入本地默认 persona 和 CLI 状态驱动
4. **桌面 Agent 钱包** — 每设备一个 Ed25519 agent 地址，显示于 settings
5. **LLM Key 配置接口** — 预留 settings UI，支持配置 API key 或复用本机订阅

### Phase 2 — Soul Integration

1. **Soul Meta 扩展** — `metadata_ref` 指向 JSON，声明形象格式、状态映射、资产引用
2. **SoulAssets 内容层** — 新增 Move 模块，与 Skills 同构（`Table<String, vector<AssetSlot>>`）
3. **ContentAccessList** — 新增 Move 模块，独立于 grant 的内容访问权售卖机制
4. **账号与内容联动** — 用户 Privy 钱包 + 桌面 agent 地址绑定、市场下载、受保护内容访问

### 不做（预留）

- Live2D 高级渲染格式
- 语音系统（预录音频 + TTS 实时合成）
- LLM 对话能力
- 从本地 LLM 文件智能抽取铸造 Soul
- 多 CLI 适配器（aider、Cursor、Windsurf 等）

## Reference

- [Desktop-Claw](https://github.com/DjTaNg-404/Desktop-Claw) — Electron companion shell，窗口模型、workspace 分层、本地 backend
- [Confirmo](https://confirmo.app) — Electron 桌面宠物，文件监听协议，Claude Code + Codex hooks

---

## Module 1 — 统一状态协议

### 状态文件

```
~/.soulidity/
├── agent-status.json          # 聚合状态（Electron main-process watcher 监听）
└── sessions/
    └── {session_id}.json      # 按 session 隔离
```

### 状态模型

```typescript
interface AgentStatusFile {
  version: 1
  lastUpdated: number
  sessions: Record<string, AgentSession>
}

interface AgentSession {
  sessionId: string
  clientType: 'claude-code' | 'codex' | 'custom'
  status: 'idle' | 'thinking' | 'working' | 'needs-attention' | 'completed' | 'error'
  workingDirectory?: string
  sessionTitle?: string
  currentAction?: {
    tool?: string
    details?: string
    timestamp: number
  }
  needsAttention?: string       // tool name requiring user input
  startedAt: number
  lastUpdated: number
  endedAt?: number
}
```

### 适配器

两个轻量 hook 脚本，安装到各自 CLI 的 hooks 目录：

**`soulidity-claude-hook.js`** — 处理 6 种 Claude Code hook 事件：

| Hook Event | → Status |
|------------|----------|
| `SessionStart` | `idle` |
| `UserPromptSubmit` | `working` |
| `PreToolUse` | `working` + currentAction 详情 |
| `PostToolUse` | `working`（清除 currentAction） |
| `Stop` | `completed` |
| `SessionEnd` | `idle` |

- 通过 stdin 接收 JSON，原子写入（temp + rename）
- 从 `tool_input` 提取工具详情（file_path、command、pattern 等）
- 检测 attention tools（AskUserQuestion、ExitPlanMode）→ `needs-attention`
- 24h 自动清理过期 session

**`soulidity-codex-hook.js`** — 处理 Codex `notify` 事件：

| Event Type | → Status |
|------------|----------|
| `agent-turn-complete` | `completed` |

- 通过命令行参数接收 JSON
- 从 `input-messages` 提取 session title
- 支持转发到用户原有的 notify 命令

### Electron 主进程侧监听

Electron main process watch `~/.soulidity/agent-status.json`：
- 启动时先读一次当前状态作为初始值
- 文件变化后解析 JSON，并向需要状态的窗口广播 `agent-status-changed`
- 监听器需要容忍原子写入过程中的短暂半成品文件

---

## Module 2 — 双窗口 Electron 应用

### 窗口架构

```
Desktop-Claw workspace
│
├─ Electron Main Process
│  ├─ window lifecycle
│  ├─ status watcher
│  ├─ wallet IPC
│  └─ secure storage / protocol wiring
│
├─ MainWindow（Desktop-Claw 主面板，扩展）
│  ├─ library / market / settings / agent 管理
│  ├─ settings 增加 agent wallet / LLM config
│  └─ 后续可扩展 marketplace / auth / grants
│
└─ OverlayWindow（透明悬浮 companion）
   ├─ transparent: true
   ├─ frameless
   ├─ alwaysOnTop: true
   ├─ skipTaskbar: true
   ├─ 初始尺寸：256x256（可配置）
   ├─ 位置：记忆上次位置（userData/state/overlay_position.json）
   └─ 内容：Canvas sprite 动画 + 状态气泡 + 右键菜单
```

### OverlayWindow 交互

| 操作 | 行为 |
|------|------|
| 拖拽 | 移动位置（`-webkit-app-region: drag`），松手保存位置 |
| 左键点击 | 展开状态气泡（当前 session 摘要：状态、工具、标题） |
| 右键 | 上下文菜单：切换形象 / 打开主窗口 / 收回宠物 / 设置 |
| 状态变化 | 播放过渡动画（idle → working 等） |
| 无活跃 session | 显示 idle 动画 |

### Electron IPC Contracts（新增）

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

// status protocol
getCurrentAgentStatus(): Promise<AgentStatusFile | null>
onAgentStatusChanged(listener: (status: AgentStatusFile) => void): () => void

// llm config
saveLlmConfig(config: LlmConfig): Promise<void>
loadLlmConfig(): Promise<LlmConfig | null>
```

### 本地存储扩展

```
userData/
├── state/
│   ├── installed_personas.json      # 现有
│   ├── active_persona.json          # 现有
│   ├── auth_session.json            # 现有
│   ├── catalog_cache.json           # 现有
│   ├── agent_keypair.json           # 新增：仅 public metadata
│   ├── overlay_position.json        # 新增：悬浮窗口位置
│   └── llm_config.json             # 新增：LLM key 配置
│
└── personas/
    ├── bundles/                     # 现有
    └── runtime/                     # 现有，存放解密后的形象资产
```

---

## Module 3 — Sprite Sheet 渲染

### 渲染方案

一期使用原生 Canvas API + `requestAnimationFrame`，不引入 Phaser/Pixi（包体小，sprite sheet 播放足够）。

### Sprite Sheet 配置

```typescript
interface SpriteSheetConfig {
  src: string                    // 本地 sprite sheet 图片路径
  frameWidth: number             // 单帧宽度 (px)
  frameHeight: number            // 单帧高度 (px)
  columns: number                // sheet 列数
  animations: {
    [stateName: string]: {       // 与 AgentSession.status 对应
      frames: number[]           // 帧索引序列（从 0 开始，左到右上到下）
      fps: number                // 播放帧率
      loop: boolean              // 是否循环
    }
  }
}
```

### 渲染循环

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
  private tick(timestamp: number): void   // requestAnimationFrame callback
  private drawFrame(frameIndex: number): void
}
```

### 状态过渡

当 agent status 变化时：
1. 查找 persona 的 stateMap 获取目标动画名
2. 如果当前动画 ≠ 目标动画，切换播放
3. 非 loop 动画播放完毕后自动回到 idle

---

## Module 4 — Soul Metadata 扩展

### metadata_ref 用途

Soul 链上对象已有 `metadata_ref: Option<String>` 字段。用它指向一个 JSON metadata URL（存储于 Walrus public blob 或 CDN）。不需要修改 Move 合约中的 Soul struct。

### Metadata JSON Schema

```typescript
interface SoulMetadata {
  version: 1

  persona?: {
    format: 'sprite-sheet' | 'live2d'     // 一期只实现 sprite-sheet

    // 状态 → 动画名映射
    stateMap: {
      idle: string
      thinking: string
      working: string
      'needs-attention': string
      completed: string
      error: string
    }

    // 公开资产（预览、marketplace 展示）
    publicAssets?: SpriteSheetAsset

    // 加密资产引用（需要 owner / grant / allowlist 访问）
    protectedAssets?: {
      assetName: string             // 对应 SoulAssets 中的 key
      versionIndex: number
    }
  }

  // 语音（一期预留）
  voice?: {
    format: 'clips' | 'tts-profile'
    clips?: Record<string, string>    // event → asset name
    ttsProfile?: {
      provider: string
      voiceId: string
      config?: Record<string, unknown>
    }
  }

  extra?: Record<string, unknown>
}

interface SpriteSheetAsset {
  type: 'sprite-sheet'
  sheetUrl: string                   // public blob URL
  frameWidth: number
  frameHeight: number
  columns: number
  animations: {
    [name: string]: {
      frames: number[]
      fps: number
      loop: boolean
    }
  }
}
```

### 创作者发布流程

```
1. 绘制 sprite sheet（各状态动画帧排列在一张图上）
2. 上传到 Walrus
   ├─ 公开版 → public blob（预览用）
   └─ 完整版 → encrypted blob（可选，通过 SoulAssets 管理）
3. 构建 metadata JSON → 上传 Walrus public blob → 获取 URL
4. mint Soul 时填入 metadata_ref = URL
```

### 桌面端下载流程

```
1. 读 Soul 的 metadata_ref → fetch JSON
2. 解析 persona 字段
3. 有 publicAssets？→ 直接下载 sprite sheet
4. 有 protectedAssets？
   ├─ 用户是 owner → 通过 access API 解密下载
   ├─ 用户在 ContentAccessList → 通过 access API 解密下载
   ├─ 桌面 agent 有 grant → 通过 agent access API 解密下载
   └─ 无权限 → 仅使用 publicAssets（预览/低帧版）
5. 存入 userData/personas/runtime/{soul-id}/
6. 生成本地 SpriteSheetConfig → 悬浮窗口加载
```

---

## Module 5 — SoulAssets 内容层

### Move 合约（新增 `assets.move`）

与 `skills.move` 同构设计：

```move
module soulidity::assets {
    use sui::table;
    use walrus::blob::Blob;

    // 资产类型常量
    const ASSET_TYPE_SPRITE: u8 = 0;
    const ASSET_TYPE_LIVE2D: u8 = 1;
    const ASSET_TYPE_AUDIO: u8 = 2;

    public struct AssetSlot has copy, drop, store {
        blob_object_id: ID,
        is_public: bool,
        deleted: bool,
        asset_type: u8,
        created_at_ms: u64,
    }

    public struct SoulAssets has key {
        id: UID,
        soul_id: ID,
        assets: table::Table<String, vector<AssetSlot>>,
        asset_count: u64,
    }

    // Events
    public struct AssetAppended has copy, drop {
        soul_id: ID,
        assets_id: ID,
        asset_name: String,
        version_index: u64,
        blob_object_id: ID,
        is_public: bool,
        asset_type: u8,
        writer: address,
    }

    public struct AssetDeleted has copy, drop {
        soul_id: ID,
        assets_id: ID,
        asset_name: String,
        version_index: u64,
    }

    // --- Write functions ---

    public fun append_as_owner(
        assets: &mut SoulAssets,
        state: &SoulState,
        asset_name: String,
        is_public: bool,
        asset_type: u8,
        content_blob: Blob,
        clock: &Clock,
        ctx: &mut TxContext,
    ): u64

    public fun append_as_granted_agent(
        assets: &mut SoulAssets,
        state: &SoulState,
        soul_grant: &SoulGrant,
        asset_name: String,
        is_public: bool,
        asset_type: u8,
        content_blob: Blob,
        clock: &Clock,
        ctx: &mut TxContext,
    ): u64

    // --- Delete ---

    public fun soft_delete_as_owner(
        assets: &mut SoulAssets,
        state: &SoulState,
        asset_name: String,
        version_index: u64,
        ctx: &TxContext,
    )
}
```

### SoulState 扩展

```move
public struct SoulState has key {
    // ... existing fields ...
    assets_id: Option<ID>,    // 新增：链接到 SoulAssets
}
```

### Seal Policy 扩展

新增两个 entry function（与 skills 的 seal policy 对称）：

```move
entry fun seal_approve_asset_read_owner(
    id: vector<u8>,
    state: &SoulState,
    assets: &SoulAssets,
    asset_name: String,
    version_index: u64,
    ctx: &TxContext,
)

entry fun seal_approve_asset_read_granted_agent(
    id: vector<u8>,
    state: &SoulState,
    assets: &SoulAssets,
    asset_name: String,
    version_index: u64,
    soul_grant: &SoulGrant,
    clock: &Clock,
    ctx: &TxContext,
)
```

Seal document ID 格式：`soul-asset:{version}:{assets_id}:{asset_name}:{version_index}:{nonce}`

### Prisma Schema 扩展

```prisma
model SoulAssetVersionRecord {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  soulOnChainId     String    @map("soul_on_chain_id")
  soul              SoulAsset @relation("SoulAssetAssetVersions", ...)
  assetsOnChainId   String    @map("assets_on_chain_id")
  assetName         String    @map("asset_name")
  versionIndex      Int       @map("version_index")
  assetType         String    @map("asset_type")   // "sprite" | "live2d" | "audio"
  visibility        String                          // "public" | "private"
  deletedAt         DateTime? @map("deleted_at")
  blobObjectId      String    @map("blob_object_id")
  blobId            String?   @map("blob_id")
  sealSidecar       Json?     @map("seal_sidecar")
  createdAtMs       BigInt    @map("created_at_ms")
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @default(now()) @updatedAt

  @@unique([assetsOnChainId, assetName, versionIndex])
  @@index([soulOnChainId, assetName, versionIndex(sort: Desc)])
}
```

### API Routes

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/souls/[id]/assets` | GET | 列出 Soul 的所有资产 |
| `/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/access` | GET | Human 访问资产（owner / allowlist） |
| `/api/agent/souls/[id]/assets/[assetName]/versions/[versionIndex]/access` | GET | Agent 访问资产（grant） |
| `/api/souls/[id]/assets/append` | POST | 上传新资产版本 |
| `/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/delete` | POST | 软删除 |

---

## Module 6 — ContentAccessList

### 设计原则

- 独立于 grant 体系，不随 Soul 所有权转移失效
- 支持链上原子付款（USDC）+ 链下手动添加
- 按 address 索引，O(1) 查找
- 可设置过期时间
- creator 和 owner 均可管理

### Move 合约（新增 `content_access.move`）

```move
module soulidity::content_access {
    use sui::table;

    public struct ContentAccessList has key {
        id: UID,
        soul_id: ID,
        creator: address,
        entries: table::Table<address, ContentAccessEntry>,
        entry_count: u64,
    }

    public struct ContentAccessEntry has copy, drop, store {
        scope_mask: u64,             // SCOPE_SKILLS=4, SCOPE_ASSETS=8, or combination
        price_paid_atomic: u64,      // 0 = free / manual grant
        granted_at_ms: u64,
        expires_at_ms: Option<u64>,
    }

    // Events
    public struct ContentAccessGranted has copy, drop {
        soul_id: ID,
        access_list_id: ID,
        grantee: address,
        scope_mask: u64,
        price_paid_atomic: u64,
    }

    public struct ContentAccessRevoked has copy, drop {
        soul_id: ID,
        access_list_id: ID,
        grantee: address,
    }

    // --- 链上付款购买 ---

    public entry fun purchase_content_access(
        access_list: &mut ContentAccessList,
        state: &SoulState,
        market_config: &MarketConfig,
        payment: Coin<USDC>,
        scope_mask: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    )
    // 1. 验证 payment >= 定价
    // 2. 分润：platform_fee + creator_royalty + owner_share
    // 3. 将 sender 加入 entries
    // 4. emit ContentAccessGranted

    // --- 手动添加（creator 或 owner）---

    public entry fun add_access(
        access_list: &mut ContentAccessList,
        state: &SoulState,
        grantee: address,
        scope_mask: u64,
        expires_at_ms: Option<u64>,
        clock: &Clock,
        ctx: &TxContext,
    )
    // 仅 creator 或 current_owner 可调用

    // --- 撤销 ---

    public entry fun revoke_access(
        access_list: &mut ContentAccessList,
        state: &SoulState,
        grantee: address,
        ctx: &TxContext,
    )
    // 仅 creator 或 current_owner 可调用

    // --- 查询 ---

    public fun has_access(
        access_list: &ContentAccessList,
        addr: address,
        required_scope: u64,
        clock: &Clock,
    ): bool
}
```

### Scope 常量

复用现有 scope bit 定义并扩展：

```move
const SCOPE_SEAL: u64 = 1;      // soul.md 访问
const SCOPE_MEMORY: u64 = 2;    // memory 访问
const SCOPE_SKILLS: u64 = 4;    // skills 访问
const SCOPE_ASSETS: u64 = 8;    // persona/voice 资产访问（新增）
```

### Seal Policy 扩展

新增 allowlist 验证函数（对 skills 和 assets 均适用）：

```move
entry fun seal_approve_skill_allowlisted(
    id: vector<u8>,
    state: &SoulState,
    skills: &SoulSkills,
    skill_name: String,
    version_index: u64,
    access_list: &ContentAccessList,
    clock: &Clock,
    ctx: &TxContext,
)
// 1. assert_matching_document_id (soul-skill: prefix)
// 2. 验证 sender 在 access_list 中
// 3. 验证 scope_mask 包含 SCOPE_SKILLS (4)
// 4. 验证未过期
// 5. 验证 skill slot 未删除

entry fun seal_approve_asset_allowlisted(
    id: vector<u8>,
    state: &SoulState,
    assets: &SoulAssets,
    asset_name: String,
    version_index: u64,
    access_list: &ContentAccessList,
    clock: &Clock,
    ctx: &TxContext,
)
// 1. assert_matching_document_id (soul-asset: prefix)
// 2. 验证 sender 在 access_list 中
// 3. 验证 scope_mask 包含 SCOPE_ASSETS (8)
// 4. 验证未过期
// 5. 验证 asset slot 未删除
```

### 定价模型

定价存储在 ContentAccessList 对象内（`price_atomic: u64` 字段），与 Soul 售价独立。一期支持：
- 固定 USDC 价格，creator 铸造时设定
- creator 和 current owner 均可调价（`set_content_price` entry function）
- 分润比例复用 MarketConfig（platform_fee_bps + creator_royalty_bps）
- 价格为 0 时视为免费，仍需调用 `purchase_content_access`（零付款）以加入 allowlist

### Prisma Schema

```prisma
model ContentAccessRecord {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  soulOnChainId     String    @map("soul_on_chain_id")
  soul              SoulAsset @relation("SoulContentAccess", ...)
  accessListOnChainId String  @map("access_list_on_chain_id")
  granteeAddress    String    @map("grantee_address")
  scopeMask         Int       @map("scope_mask")
  pricePaidAtomic   BigInt    @map("price_paid_atomic")
  grantedAtMs       BigInt    @map("granted_at_ms")
  expiresAtMs       BigInt?   @map("expires_at_ms")
  revokedAt         DateTime? @map("revoked_at")
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @default(now()) @updatedAt

  @@unique([accessListOnChainId, granteeAddress])
  @@index([soulOnChainId])
  @@index([granteeAddress])
}
```

### API Routes

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/souls/[id]/access-list` | GET | 查询 Soul 的 ContentAccessList |
| `/api/souls/[id]/access-list/purchase` | POST | 链上付款后同步记录 |
| `/api/souls/[id]/access-list/add` | POST | 手动添加（owner/creator） |
| `/api/souls/[id]/access-list/revoke` | POST | 撤销访问权 |

### 访问判定优先级

对 skills 和 assets 的 access API，验证顺序：

```
1. viewer 是 owner？ → seal_approve_*_read_owner
2. viewer 有 active grant（含对应 scope）？ → seal_approve_*_read_granted_agent
3. viewer 在 ContentAccessList（含对应 scope）？
   ├─ skills → seal_approve_skill_allowlisted
   └─ assets → seal_approve_asset_allowlisted
4. 均不满足 → 403
```

---

## Module 7 — 双钱包与 Agent 身份

### Agent Keypair 生成

桌面端首次启动时，Electron main process 生成 Ed25519 keypair：

```ts
// apps/desktop/src/main/agent-wallet.ts
interface AgentKeypairInfo {
  address: string     // Sui address (0x...)
  publicKey: string   // hex-encoded
  createdAt: number
}
```

- 地址推导遵循 Sui SDK `toSuiAddress()` 语义，不手写 `SHA-256` 规则
- 存储：`userData/state/agent_keypair.json`（仅 public 信息）+ 系统 keychain / secure storage（private key）
- 每台设备一个 agent 地址，不跨设备复用

### 登录绑定流程

```
1. 用户在桌面端完成浏览器登录（现有 device auth 流程）
2. 登录成功后，桌面端将 agent_address 上报到 web 端
3. POST /api/desktop/me/agent
   ├─ body: { agentAddress, deviceCode }
   └─ web 端将 agent_address 关联到用户 Member 记录
4. 如果用户有 Soul → agent 地址显示在 Soul 的可授权对象列表中
5. 如果用户没有 Soul → agent 地址只显示在"my agents"页面
```

### Agent 地址用途

| 场景 | 钱包 | 说明 |
|------|------|------|
| 购买 Soul | Privy 钱包 | 链上交易签名 |
| 购买内容访问权 | Privy 钱包 | 链上 USDC 付款 |
| 铸造 Soul | Privy 钱包 | 创作者操作 |
| 接收 grant | Agent 地址 | owner 授权 agent 操作 Soul |
| 通过 grant 读写 memory/skills | Agent 地址 | agent 级别操作 |
| 下载已购形象（allowlist） | Privy 钱包地址 | allowlist 以购买者地址为 key |

---

## Module 8 — LLM 配置（预留）

### 配置结构

```typescript
interface LlmConfig {
  provider: 'anthropic' | 'openai' | 'local' | 'custom'
  apiKey?: string               // 用户填入
  useLocalSubscription: boolean // 复用本机 CLI 的订阅/key
  customEndpoint?: string       // custom provider URL
  model?: string                // 模型偏好
}
```

### 一期实现

- Settings 页面 UI：输入框 + provider 选择 + "use local" 开关
- 存储到 `userData/state/llm_config.json`
- 不实际调用 LLM — 仅保存配置，供二期对话功能使用

---

## Data Flow Summary

### 创作者发布形象资产

```
创作者绘制 sprite sheet
  → 上传 Walrus（加密或公开）
  → 构建 SoulMetadata JSON → 上传 Walrus public blob
  → mint Soul (metadata_ref = URL)
  → 可选：设定内容访问价格
  → marketplace 展示（公开预览 + 付费完整版）
```

### 买家购买与使用

```
浏览 marketplace → 预览公开形象
  → purchase_content_access() 链上 USDC 付款
  → 地址加入 ContentAccessList
  → web 端可查看已购内容

桌面端：
  → 登录 → 浏览已购形象
  → 下载解密形象资产到本地
  → 选择 active persona → "放出"悬浮窗口
  → file watcher 监听 LLM CLI 状态
  → 状态变化 → sprite 切换动画帧
```

### Agent 授权与交互

```
用户有 Soul → 在 web 端给桌面 agent 地址 issue grant
  → 桌面端 agent 可通过 grant 访问 Soul 的 memory/skills
  → 未来：agent 自主读写 memory、调用 skills
```

---

## Constraints

- 以 Desktop-Claw Electron workspace 为基础扩展，不保留并行 Tauri 实现路线
- Move 合约新增模块（assets.move、content_access.move），不修改现有 Soul/SoulState 核心字段（除了新增 `assets_id: Option<ID>`）
- SoulAssets 与 Skills 同构，复用相同的 event parsing、mirror、repository 模式
- ContentAccessList 独立于 grant 体系，不受 ownership_epoch 影响
- 一期 sprite sheet 渲染用原生 Canvas API，不引入 Phaser/Pixi
- Agent keypair 的 private key 存系统 keychain，不明文存 JSON
- 适配器脚本保持极简（单文件 Node.js，零依赖），方便用户安装
- 所有链上操作的 DB 同步走现有 post-TX direct write 模式

## Acceptance Criteria

1. Claude Code hook 安装后，在桌面端悬浮窗口看到形象随 CLI 状态实时切换（idle / working / completed）
2. Codex hook 安装后，agent-turn-complete 事件反映在悬浮窗口状态上
3. 从 marketplace 浏览并下载一个 sprite sheet 格式的 Soul 形象到桌面端
4. 创作者上传形象资产（sprite sheet）到 SoulAssets，设置为 public 或 private
5. 买家通过 purchase_content_access 链上付款后，可解密下载 private 形象资产
6. creator/owner 可手动通过 add_access 添加地址到 ContentAccessList
7. 桌面端登录后自动生成 agent 地址并绑定到用户账户
8. Soul owner 给桌面 agent 地址 issue grant 后，agent 可通过 grant 访问 Soul 内容
9. LLM 配置页面可保存 provider/key 设置到本地（不实际调用）
10. `sui move test --path move/soulidity` 通过
11. `npm test` 相关测试通过
12. `npm --prefix web run typecheck` 通过
13. `npm --prefix web run build` 通过
