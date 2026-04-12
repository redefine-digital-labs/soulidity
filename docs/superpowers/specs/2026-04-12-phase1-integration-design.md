# Phase 1 收口 — 4 Gap 接通设计

> **Status**: Approved  
> **Date**: 2026-04-12  
> **Branch**: companion

## Problem

Phase 1 的 8 个模块已全部实现并通过测试，但模块间没有接通：FloatingBall 仍用 CSS emoji 渲染、useCliStatus hook 无人消费、sprite sheet 缺失、Desktop API 路由未还原。

## Goals

1. 用乌萨奇 sprite sheet 替换 FloatingBall 的 emoji 渲染
2. 用 CLI 原始 6 状态（idle/thinking/working/needs-attention/completed/error）直接驱动 SpriteRenderer
3. 还原 Desktop API 全套（profile/catalog/device）+ Prisma models + 支撑库 + 测试

## Non-Goals

- 不做 persona 编辑器或上传流程
- 不做 WebSocket push（保留轮询 fallback）
- 不做 sprite sheet 生成工具

---

## Gap A: Sprite Sheet 资产

### 资产目录约定

`desktop/data/assets/` — 存储形象资产的目录（zip 包形式）。

### 默认 persona 资产

从 `desktop/data/assets/乌萨奇！！.zip` 解压到 `desktop/apps/desktop/resources/default-persona/`：
- `sprite.png` — 4096×3584，8 列 × 7 行，56 帧，每帧 512×512
- `manifest.json` — 原始 manifest

### sprite-config.json 更新

替换现有配置，匹配乌萨奇参数：

```json
{
  "src": "sprite.png",
  "frameWidth": 512,
  "frameHeight": 512,
  "columns": 8,
  "animations": {
    "idle":            { "frames": [0,1,2,3,4,5,6,7],    "fps": 4,  "loop": true },
    "thinking":        { "frames": [8,9,10,11,12,13,14,15], "fps": 6,  "loop": true },
    "working":         { "frames": [24,25,26,27,28,29,30,31], "fps": 8,  "loop": true },
    "needs-attention":  { "frames": [32,33,34,35,36,37,38,39], "fps": 4,  "loop": true },
    "completed":       { "frames": [16,17,18,19,20,21,22,23], "fps": 4,  "loop": false },
    "error":           { "frames": [40,41,42,43,44,45,46,47], "fps": 2,  "loop": true }
  }
}
```

帧分配（基于视觉内容）：
| 行 | 帧范围 | 内容 | 映射状态 |
|----|--------|------|----------|
| 0 | 0-7 | 站立/开心 | idle |
| 1 | 8-15 | 表情变化 | thinking |
| 2 | 16-23 | 趴着/休息 | completed |
| 3 | 24-31 | 打字/工作 | working |
| 4 | 32-39 | 惊讶/变脸 | needs-attention |
| 5 | 40-47 | 翻身/看信 | error |
| 6 | 48-55 | 趴睡（备用） | — |

---

## Gap B: FloatingBall → SpriteRenderer + CLI 状态

### 改动文件

| 文件 | 改动 |
|------|------|
| `FloatingBall/index.tsx` | 导入 SpriteRenderer + useCliStatus，替换 emoji 为 canvas |
| `useCliStatus.ts` | 直接返回原始 `status`，移除 emotion 映射层 |
| `FloatingBall/styles.css` | `.ball__icon` 改为容纳 canvas，保留 CSS halo 作叠加 |

### 状态驱动逻辑

SpriteRenderer 直接消费 CLI 原始 6 状态，不经过 emotion 映射：

```
CLI status watcher 有活跃 session
  → status (idle/thinking/working/needs-attention/completed/error)
  → 直接传给 SpriteRenderer animation prop

CLI status 无 session / 文件不存在
  → fallback 到 useClawEmotion
  → 映射: idle→idle, busy→working, done→completed, night→error
```

### CSS halo 保留

CSS 呼吸灯/光晕效果保留作为叠加层。`data-emotion` 属性从 6 状态映射到 4 emotion 来驱动 CSS：
- idle → idle
- thinking/working → busy
- completed → done
- needs-attention/error → night

### SpriteRenderer 接入

```tsx
const { status: cliStatus } = useCliStatus()
const { emotion } = useClawEmotion()

const animationState = cliStatus !== 'idle'
  ? cliStatus
  : emotionToCliStatus(emotion) // idle→idle, busy→working, done→completed, night→error

<SpriteRenderer config={spriteConfig} animation={animationState} width={56} height={56} />
```

Canvas 渲染 512→56 缩放由 SpriteRenderer 的 width/height prop 控制。

---

## Gap C: Desktop API 全套还原

### Prisma Models（新增 3 个）

```prisma
model DesktopProfile {
  id              String   @id @default(uuid())
  accountId       String   @unique @map("account_id")
  account         Account  @relation(fields: [accountId], references: [id])
  activeSourceType String? @map("active_source_type")  // 'starter' | 'soul' | null
  activeSourceRef  String? @map("active_source_ref")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("desktop_profiles")
}

model DesktopCatalogEntry {
  id          String   @id @default(uuid())
  sourceType  String   @map("source_type")  // 'starter' | 'soul'
  sourceRef   String   @map("source_ref")
  name        String
  description String?
  imageUrl    String?  @map("image_url")
  isPublished Boolean  @default(true) @map("is_published")
  sortOrder   Int      @default(0) @map("sort_order")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@unique([sourceType, sourceRef])
  @@map("desktop_catalog_entries")
}

model DesktopDeviceSession {
  id          String   @id @default(uuid())
  deviceCode  String   @unique @map("device_code")
  userCode    String   @map("user_code")
  accountId   String?  @map("account_id")
  confirmedAt DateTime? @map("confirmed_at")
  expiresAt   DateTime @map("expires_at")
  createdAt   DateTime @default(now()) @map("created_at")

  @@map("desktop_device_sessions")
}
```

### API 路由

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/api/desktop/me` | GET | Human auth | 返回 profile + active persona manifest |
| `/api/desktop/me/active-persona` | PUT | Human auth | 切换 active persona |
| `/api/desktop/catalog` | GET | Anonymous | 分页 catalog 列表 |
| `/api/desktop/catalog/[id]` | GET | Anonymous | 单个 persona manifest + 下载信息 |
| `/api/desktop/device/start` | POST | Anonymous | 创建设备绑定 session |
| `/api/desktop/device/poll` | POST | Anonymous | 轮询设备绑定状态 |

### 支撑库

| 文件 | 说明 |
|------|------|
| `web/lib/desktop/profile.ts` | getDesktopMe, setDesktopActivePersona |
| `web/lib/desktop/device-session.ts` | startDesktopDeviceSession, pollDesktopDeviceSession |
| `web/lib/desktop/repository.ts` | listDesktopCatalogItems, findDesktopPersonaManifestById/BySource |
| `web/lib/types/desktop.ts` | DesktopCatalogSourceType, DesktopCatalogItem, DesktopPersonaManifest, DesktopProfile, DesktopMeResponse, DesktopDeviceStartResponse, DesktopDevicePollResponse |

### 测试

从 git 历史恢复 6 个测试文件：
- `tests/new-web/desktop-profile-routes.test.ts`
- `tests/new-web/desktop-profile-service.test.ts`
- `tests/new-web/desktop-device-routes.test.ts`
- `tests/new-web/desktop-device-session.test.ts`
- `tests/new-web/desktop-catalog-routes.test.ts`
- `tests/new-web/desktop-catalog-repository.test.ts`

需要适配当前 schema 和 import 路径，不是盲目复制。

---

## 验收标准

1. FloatingBall 渲染乌萨奇 sprite 动画（不是 emoji）
2. CLI agent status 变化时，sprite 动画实时切换对应状态
3. 无 CLI session 时 fallback 到后端 emotion
4. 6 个 Desktop API 端点全部可用且有测试
5. `npm test` 不引入新失败
6. Move tests 不受影响（40/40）

## 依赖链

```
Gap A (解压 sprite sheet + 更新 config)
  → Gap B (FloatingBall 接入 SpriteRenderer + useCliStatus)

Gap C (Desktop API) — 独立，可并行
```
