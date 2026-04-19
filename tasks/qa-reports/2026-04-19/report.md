# E2E QA 报告 — 个人资料改版（Profile Redesign）

- **日期**：2026-04-19
- **环境**：`localhost:3100`（web/，Next.js 16 dev server）
- **登录账号**：`ithinco@gmail.com`（Privy 邮箱）→ memberId `0c3f9df5-6bd3-4cec-a9dd-bb74afa5dd5b`，handle `ithinco_qa`，wallet `0x858d…eb82`，admin
- **覆盖范围**：未提交的 profile/cover/handle/wallet 改造 + 社区公开页改版 + 核心路由冒烟
- **未覆盖**：链上交易（mint / buy / grant，需要钱包签名）、Lighthouse / 性能、移动端 viewport
- **截图目录**：`tasks/qa-reports/2026-04-19/*.png`

---

## 总览

| 类别  | 数量 |
| --- | --- |
| 用例总数 | 10 |
| ✅ 通过 | 10（含 T6 的 handle URL 修复后再验） |
| ❌ 失败 | 0 |
| 阻断性环境问题 | 1（迁移未 apply，已现场修复） |
| 修复的 Major bug | 1（F1 handle URL 500） |

**结论**：核心功能全部通过，**P0 改造连同 handle URL fix 一起可以合入**。

---

## 阻断性环境问题（已现场修复）

### B0 — `prisma/migrations/20260419123000_add_member_cover_image` 未 apply
- **症状**：`/api/auth/me` 整段 500，`AuthGate` 永远跳到 "Sign in to edit your profile"，所有 auth-gated 页面阻断
- **根因**：`web/app/api/auth/me/route.ts:28` 选 `coverImage`，DB 列 `members.cover_image` 不存在
- **现场处理**：用户授权后执行 `npx prisma migrate deploy`，迁移已 apply，dev server 重启后恢复
- **后续动作**：把 `prisma/migrations/20260419123000_add_member_cover_image/` 提交到 git；CI / production 部署时确保 migrate 链正确

---

## 逐项结果

### T1 资料编辑页加载  ✅ PASS
- 截图：`02-profile-loaded.png`
- `/api/auth/me` 200，AuthGate 通过，所有 section 渲染：Cover / Wallet / Emoji / DisplayName / Handle / Bio / Social Links / Save
- 控制台：仅 Privy 自身的 Solana 连接器告警（pre-existing，非本次改造引入）

### T2 Cover Image 上传 + 裁剪  ✅ PASS
- 截图：`03-crop-modal.png`、`04-cover-saved.png`
- 上传 1200×1200 PNG → 裁剪弹窗弹出 → "Use this crop" enabled
- Save → `POST /api/profile/cover [200]` → `PATCH /api/profile [200]` → 预览替换为 Walrus URL，显示 "Saved profile cover"
- 输出格式正确：`qa-cover.webp · 13.0 KB · 1:1 WebP · cropped`，符合 picker 自述（≤2MB，WebP 优先）

### T3 资料保存  ✅ PASS
- 截图：`04-cover-saved.png`
- 改 displayName=`ithinco QA`、handle=`ithinco_qa`、bio、twitterUrl=`https://x.com/ithinco`、websiteUrl=`https://ithinco.dev`、emoji=👻
- `PATCH /api/profile [200]`；reload 后 `/api/auth/me` 全部字段持久化
- Navbar 同步更新为 "👻 ithinco QA"

### T4 Handle 校验  ✅ PASS
- 截图：`05-handle-validation.png`
- `admin`（reserved）→ 400 + 前端显示 "This handle is reserved"
- `ab`（< 3 字符）→ 400 + 前端显示 "handle must be 3-30 alphanumeric/underscore characters"
- 恢复成 `ithinco_qa`，PATCH 200

### T5 Wallet 同步  ✅ PASS
- `Re-sync wallet` 触发 `POST /api/profile/wallet [200]`
- Primary wallet 显示 `0x858d…eb82`（`primarySuiAddress` 一致）

### T6 社区公开页  ⚠️ PASS（含 Major bug）
- 截图：`06-public-profile.png`
- **UUID 路径** `/community/u/0c3f9df5-...` 完整通过：
  - cover 用 `background-image + linear-gradient` 渲染（Walrus blob）
  - `ProfileStatsPill`：`0 Souls · 0 Posts`、`New Trainer` badge
  - 三个 tab 切换正常（Souls / Posts / About）
  - About tab 对 owner 可见 Primary wallet（与 API 中 `isOwnProfile ? walletBindings[0]?.address : null` 行为一致）
  - 空 Souls 状态 CTA 正确：`+ Mint a Soul → /create`、`Import existing → /import`
- **Handle 路径** `/community/u/ithinco_qa` 直接 500 → 详见下方 **F1**

### T7 `/market`  ✅ PASS
- 截图：`07-market.png`
- 控制台无 error，页面正常渲染

### T8 `/my-souls`  ✅ PASS
- 截图：`08-my-souls.png`
- 4 个 stat card + 5 个 tab + 空 Souls 状态正确
- 控制台无 error

### T9 `/create`  ✅ PASS
- 截图：`09-create.png`
- 页面正常加载，无 error

### T10 路由 / 导航  ✅ PASS
- `/profile` ↔ `/community` ↔ `/market` ↔ `/my-souls` ↔ `/create` 互跳无 404，auth 不掉
- `/community` 控制台无 error，所有内层 API（leaderboard / channels / posts / auth/me）200

---

## 问题清单

### F1 — `/community/u/<handle>` 500（Major）→ ✅ 已修

- **复现**：登录后访问 `http://localhost:3100/community/u/ithinco_qa`（或任何 handle），主区空白
- **网络**：`GET /api/community/profile/ithinco_qa [500]` + `GET /api/community/follow?memberId=ithinco_qa [500]`
- **根因**：`web/app/api/community/profile/[id]/route.ts` 与 `web/app/api/community/follow/route.ts` 都直接把 `[id]` 当 UUID 传给 Prisma 查询；`members.id` 列是 `@db.Uuid`，传入 handle 字符串触发 Postgres 类型错
- **修复**：
  - 新增 `web/lib/community/resolve-space.ts` 暴露 `resolveMemberSpaceId(spaceId)`，UUID 直查 / handle 走 `findFirst({ handle: lower(spaceId) })`，统一返回成员 UUID 或 null
  - `web/app/api/community/profile/[id]/route.ts`：先 resolve，未命中返回 404
  - `web/app/api/community/follow/route.ts`：GET / POST 都先 resolve；GET 对未知 id graceful 返回 `{isFollowing:false, followerCount:0, followingCount:0}`，POST 未命中返回 404，删去重复的 `findUnique` 存在性校验
- **验证**（截图：`11-handle-url-fixed.png`）：
  - `GET /api/community/profile/ithinco_qa` → 200，页面完整渲染
  - `GET /api/community/follow?memberId=ithinco_qa` → 200
  - 未知 handle / 未知 UUID → 404（不再 500）
  - `vitest run web/lib/handle.test.ts` → 3/3 pass，无回归

### F2 — Cookie 中残留 Clerk JWT（Nit / 低）

- **现象**：`/api/auth/me` 请求头里带 `__clerk_db_jwt_r4TWjMAF=dvb_3C9TFzsKWQWETtA2lPRnicAWO2z; __clerk_db_jwt=dvb_3C9TFzsKWQWETtA2lPRnicAWO2z; __client_uat=0`，看起来是上一代 Clerk 鉴权遗留
- **影响**：本次没有功能影响，但每次请求多带几十字节，且容易让排查混乱
- **建议**：在退出 Clerk 时一并清这些 cookie（或通过 Set-Cookie 过期），与本次改造无强耦合

### F3 — Privy Solana 连接器告警（Nit，pre-existing）

- **现象**：每次加载 Privy 抛 `App configuration has Solana wallet login enabled, but no Solana wallet connectors have been passed to Privy.`
- **影响**：纯告警，非本次改造引入
- **建议**：要么在 PrivyProvider 里关掉 Solana login，要么补 connectors，与本批 PR 无关

---

## DESIGN.md 合规性观察

未做完整 design review（不在本轮范围）。视觉初看：
- emoji 头像、handle 标签、Stats Pill 排版与 DESIGN.md 的"功能纯粹主义"主线一致
- cover 上加 `linear-gradient(135deg, rgba(46,27,110,0.48), rgba(15,95,115,0.55))` 半透层提升文字可读性，符合 design 习惯
- Handle 错误信息用大小写不一致："This handle is reserved"（句首大写句号缺失） vs "handle must be 3-30 alphanumeric/underscore characters"（句首小写）。建议统一句首大写 + 句号

---

## 关键证据 — 网络请求摘要

| 步骤 | 请求 | 状态 |
| --- | --- | --- |
| 资料页加载 | `GET /api/auth/me` | 200 |
| Cover 上传 | `POST /api/profile/cover` | 200 |
| 资料保存 | `PATCH /api/profile` | 200 |
| Handle reserved | `PATCH /api/profile`（admin） | 400 |
| Handle 格式错 | `PATCH /api/profile`（ab） | 400 |
| Wallet 同步 | `POST /api/profile/wallet` | 200 |
| 公开页（UUID） | `GET /api/community/profile/<uuid>` | 200 |
| 公开页（handle） | `GET /api/community/profile/ithinco_qa` | 修复后 200 ✅ |
| 关注接口（handle） | `GET /api/community/follow?memberId=ithinco_qa` | 修复后 200 ✅ |
| 未知 handle | `GET /api/community/profile/no_such_handle_xyz` | 404 ✅ |
| 未知 UUID | `GET /api/community/profile/00000000-...` | 404 ✅ |

---

## 一句话结论

**P0 个人资料改版 + 公开页 handle URL fix 全部通过，可以合入。** 待提交：迁移文件、`web/lib/community/resolve-space.ts`、`profile/[id]` 与 `follow` 路由调整。
