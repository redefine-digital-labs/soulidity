# ClawNews 正式上线准备计划

> 2026-04-16 · 最近复核 **2026-04-21**

## Context

ClawNews 需要从开发阶段过渡到正式上线。上线范围：**Web 端（Soulidity Soul 市场 + 社区）+ 后端新闻管线（采集→LLM 加工→Telegram 发布）+ Desktop（Tauri）客户端独立发布**。Web 端部署平台：**Vercel**。

当前状态：核心功能已完整（75+ API 端点、135+ 测试文件、多策略认证、完整的后端管线），但缺少上线必备的基础设施配置（SEO、法律页面、监控、部署配置等）。

Move 合约已升级，4 个 HIGH 级问题全部已修复或非问题，不阻塞上线。

### 2026-04-21 复核要点

- `new-web/` 已合并回 `web/`，所有上线改动落在 `web/app/`、`web/components/`、`web/next.config.ts`。CLAUDE.md 仍残留 `new-web` 引用，属文档 drift，不阻塞上线。
- 新增 Desktop（Tauri/electron-builder）客户端，独立发布通道见 `.github/workflows/desktop-release.yml` + `web/app/download/`；Desktop 不在 Vercel 发布链路，仅列作并行工作流。2026-04-21 已完成 Web ↔ Desktop 双向隔离（tag 前缀 `desktop-v*` + Vercel Blob manifest ISR，见下文 #16 / 本轮交付）。
- 下文各项前的状态标签（✅ 已完成 / 🟡 部分完成 / ⬜ 未开始）反映 2026-04-21 仓库实际状态。

### 2026-04-21 本轮增量（#17 Lint 全绿 一次收口）

- **#17 Web lint 0 errors / 0 warnings** ✅：
  - **4 个 React hook 错误全部修复**：
    - `web/lib/hooks/use-wallet-balances.ts`：删除两处渲染期 ref 读写（`currentWalletAddressRef`、`previousWalletAddressRef`、`useLayoutEffect`），staleness 统一由 `requestVersionRef` 判定，`walletChanged` 由 `isCurrentAddress = state.walletAddress === walletAddress` 替代。2 个单测 (`tests/new-web/use-wallet-balances.test.tsx`) 全绿。
    - `web/components/providers/create-soul-provider.tsx` / `import-soul-provider.tsx`：hydration 改为 React 官方"adjust state on prop change"模式（渲染期比较 `hydratedForUserId !== userId`），不再在 `useEffect` 里同步 setState。3 + 4 个单测 (`create-soul-provider.test.ts` / `publish-provider-hydration.test.tsx`) 全绿。
  - **2 个 exhaustive-deps 警告修复**：
    - `web/lib/hooks/use-collection-publish.ts`：`clearRecoveryState` 包 `useCallback`，加入 `useEffect` 依赖数组。
    - `web/lib/hooks/use-wrap-publish.ts`：`publish` useCallback 补 `suiClient` 依赖。
  - **3 个 unused eslint-disable 清理**：
    - `web/lib/hooks/use-privy-sui.ts:11`、`web/app/api/agent/souls/[id]/purchase/route.ts:93`、`web/app/create/gas/page.tsx:173 & 304` 的 `@typescript-eslint/no-explicit-any` disable 注释删除（项目 eslint preset `next/core-web-vitals` 未启用该规则，directives 确属无用）。
  - **7 处 `<img>` 警告**：全部改用 `next/image` 的 `<Image unoptimized>`，显式 `width` / `height` 与 tailwind `h-N w-N` 对齐；`unoptimized` 规避 Walrus / `blob:` / IPFS 等远程域未登记 `remotePatterns` 的问题，不影响 thumbnail 渲染。涉及文件：`collections/create/preview/page.tsx` × 2、`community/leaderboard/page.tsx`、`wrap-link/personal/{configure,page,preview,success}/page.tsx` × 4。
- **验证**：`npm --prefix web run lint` exit 0 且无输出（0 errors / 0 warnings）；`npm --prefix web run typecheck` exit 0；`npm test` 145 files / 957 tests 全绿（含 `use-wallet-balances.test.tsx`、`publish-provider-hydration.test.tsx`、`create-soul-provider.test.ts`、`wrap-publish-recovery.test.ts`）。
- **未引入新依赖**：`next/image` 已在项目里使用；无新增 package。

### 2026-04-21 本轮增量（#16 Web ↔ Desktop 发布隔离 一次收口）

- **#16 Web ↔ Desktop 发布通道互不影响** ✅：
  - **Web → Desktop 方向**：`.github/workflows/desktop-release.yml` 的触发器由 `tags: ['v*']` 收紧为 `tags: ['desktop-v*']`。Web / 后端历史 phase tag（如 `v0.2.0-phase1a` / `v0.3.0-phase2a`）与未来的 `v*` tag 不再误触发 macOS / Windows 构建，yaml 头部写入 tag 约定备注。
  - **Desktop → Web 方向**：新增 Vercel Blob **发布 manifest** 机制。`web/scripts/upload-desktop-dmg.ts` 上传 dmg 的同时在固定路径 `desktop/manifest.json` 写入 `{ manifestVersion, version, publishedAt, mac.arm64 }`；`web/app/download/page.tsx` 改为 async Server Component，通过 `fetch(DESKTOP_MANIFEST_URL, { next: { revalidate: 300, tags: ['desktop-manifest'] } })` 读取 manifest → 版本 & dmg URL 均来自 Blob，Desktop 发新版无需 Vercel 重新部署。
  - **Fallback 链路**：manifest URL 未配置或不可达时，自动回退到旧的 `NEXT_PUBLIC_DESKTOP_MAC_ARM64_URL` / `NEXT_PUBLIC_DESKTOP_VERSION`（可留空 → 按钮显示 "Build coming soon"），不会硬失败。
  - **env 文档同步**：`.env.example` 新增 `DESKTOP_MANIFEST_URL`，并把两个 `NEXT_PUBLIC_DESKTOP_*` 注释改写为 fallback 语义。
  - **操作流程**：首次发布后复制 upload 脚本打印的 manifest URL 一次性写入 Vercel env `DESKTOP_MANIFEST_URL`；后续 Desktop release 只需 `pnpm --filter @soulidity/desktop run package:mac` → `npx tsx web/scripts/upload-desktop-dmg.ts <dmg>`，manifest 自动覆盖，/download 在 300s 内自动刷新。
- **验证**：`npm --prefix web run typecheck` exit 0；`npm --prefix web run lint` 4 errors + 13 warnings 全部位于既有 hooks 文件（`use-wallet-balances.ts`、`import-soul-provider.tsx`、`use-collection-publish.ts`、`use-wrap-publish.ts`、`use-privy-sui.ts`），与本次改动无关。
- **未引入新依赖**：复用已有 `@vercel/blob`、`next` 内建 ISR 机制。

### 2026-04-21 本轮交付（#3 SEO + #4 法律页面 一次收口）

- **#3 SEO** ✅：`web/app/layout.tsx` 改写 metadata（title 模板、metadataBase、openGraph、twitter、robots、viewport、keywords、alternates）；新增 `web/app/opengraph-image.tsx` / `web/app/apple-icon.tsx`（`next/og` ImageResponse 生成）；新增 `web/app/robots.ts` / `web/app/sitemap.ts`（sitemap 从 Prisma 拉 listed souls + collections + published posts，`revalidate=3600`，DB 失败时 fallback 静态路由）；为 `web/app/market/` / `web/app/community/` / `web/app/souls/[id]/` / `web/app/community/posts/[id]/` 各新增 `layout.tsx`，其中后两者实现 `generateMetadata()` 动态 OG（含价格、封面、canonical，未发布 post 自动加 `noindex`）。
- **#4 法律页面** ✅：新增 `web/app/terms/page.tsx`（13 节，覆盖身份、链上不可逆、Soul 许可、Walrus/Seal、grants、费用 & 版税、Desktop、禁止行为、免责 & 责任限额、变更 & 联络）与 `web/app/privacy/page.tsx`（12 节，覆盖数据类别、Soul 存储、第三方服务列表、Cookie、保留期、GDPR/CCPA 权利、儿童、安全）。
- **Footer 收口** ✅：新增 `web/components/layout/site-footer.tsx` 并接入 `web/components/layout/app-shell.tsx`，提供 `/terms` / `/privacy` / `/market` / `/community` / `/download` 入口（法律链接按 `/robots.ts` 放行路径可被爬虫抓到）。
- **验证**：`npm --prefix web run typecheck` 通过（exit 0）。`npm --prefix web run lint` 剩余 4 errors + 13 warnings 全部位于既有文件（`use-wallet-balances.ts`、`import-soul-provider.tsx` 等），与本次改动无关，lint exit 0。
- **未引入新依赖**：全部使用 `next/og`、`next/metadata`、现有 Prisma client。

---

## P0 — 上线阻塞项（必须完成）

### 1. Vercel 部署配置 ⬜
- **文件**: 新建 `vercel.json`，确认 `web/` 为 root directory
- **环境变量**: 在 Vercel Dashboard 配置所有 `.env.example` 中的变量（数据库、Privy、Sui、Supabase、Telegram 等）
- **Build 命令**: 已有 `web/package.json` 的 `build = prisma:generate && next build --webpack`
- **验证**: Vercel Preview Deploy 成功 + 主要页面可访问
- **2026-04-21 状态**: 根目录 / `web/` / `new-web/` 均无 `vercel.json`，未开始

### 2. 修复 TypeScript 构建 ✅
- **文件**: `web/next.config.ts`
- **原问题**: `ignoreBuildErrors: true` 让类型错误静默通过
- **2026-04-21 状态**: `web/next.config.ts` 已不存在 `ignoreBuildErrors` / `eslint.ignoreDuringBuilds`，且 `web/package.json` 新增 `typecheck` 脚本（`prisma:generate + next typegen + tsc --noEmit`）。上线前在 CI 跑 `npm --prefix web run typecheck` 即可。

### 3. SEO 基础 ✅（2026-04-21 交付）
- **已完成**:
  - `web/app/layout.tsx` — metadataBase、title 模板、openGraph、twitter、robots、viewport、applicationName、alternates canonical
  - `web/app/opengraph-image.tsx` — `next/og` ImageResponse 生成 1200×630 PNG（品牌卡：logo + 主副标题 + Sui/Walrus/Seal/USDC 标签）
  - `web/app/apple-icon.tsx` — `next/og` 生成 180×180 PNG（沿用 Soul logo 描边）
  - `web/app/icon.svg` — 已有，自动挂载 favicon
  - `web/app/robots.ts` — 允许全站爬取，禁用 `/api/` `/admin/` `/_e2e_fixture/`，指向 `/sitemap.xml`
  - `web/app/sitemap.ts` — 静态路由（`/`、`/market`、`/community`、`/community/leaderboard`、`/download`、`/terms`、`/privacy`）+ 动态路由（`SoulAsset.listingStatus='listed'` × 2000、`SoulCollectionAsset` × 1000、`Post.status='published'` × 5000），`revalidate=3600`，DB 异常时 graceful fallback
  - `web/app/market/layout.tsx`、`web/app/community/layout.tsx` — 静态 metadata
  - `web/app/souls/[id]/layout.tsx` — `generateMetadata()` 读 `SoulAsset`（name + description + imageUrl + listed price + tags → 动态 OG / Twitter Card / keywords）
  - `web/app/community/posts/[id]/layout.tsx` — `generateMetadata()` 读 `Post`（title + content 预览 + tags；`status!=='published'` 自动 `robots.index=false`）

### 4. 法律页面 ✅（2026-04-21 交付）
- **已完成**:
  - `web/app/terms/page.tsx` — 13 节（接受、账号、链上不可逆、Soul 许可、grants、费用 & 版税、社区、Desktop、禁止行为、免责、责任限额、变更、联络），`alternates.canonical` + OG/Twitter 元数据齐备
  - `web/app/privacy/page.tsx` — 12 节（范围、数据类别、Soul Walrus/Seal 存储、使用目的、第三方服务列表、Cookie、保留期、GDPR/CCPA 权利、安全、儿童、变更、联络）
  - `web/components/layout/site-footer.tsx` + 接入 `app-shell.tsx` — 全局 footer 暴露 `/terms` `/privacy` 入口及 Market / Community / Desktop 快捷链接
- **遗留**: 若后续启用专属支持邮箱 / 法律实体名称，替换文中"官方社区频道"占位语即可（不阻塞上线）

### 5. 错误监控（Sentry） ⬜
- **安装**: `@sentry/nextjs`
- **配置**: `sentry.client.config.ts` + `sentry.server.config.ts` + `sentry.edge.config.ts`
- **修改**: `web/next.config.ts` 包裹 `withSentryConfig`
- **目标**: 生产环境错误自动上报 + source map 上传
- **2026-04-21 状态**: `web/package.json` 无 `@sentry/*` 依赖，未开始

### 6. 后端部署方案 ⬜
- 后端管线（scheduler + Telegram bot，入口 `src/main.ts`）不跑在 Vercel 上
- **选项 A**: 现有服务器 `pm2` 运行 `npm run dev`
- **选项 B**: Fly.io / Railway 容器化部署
- **最少需要**: 确认后端在哪里跑、进程管理方式、日志收集
- **2026-04-21 状态**: 仓库无 `Dockerfile` / `fly.toml` / `ecosystem.config.*`，部署路径未定

---

## P1 — 上线前强烈建议（影响体验和安全）

### 7. Content-Security-Policy 安全头 🟡
- **文件**: `web/next.config.ts` 的 `securityHeaders` 数组
- **2026-04-21 现状**: 已有 X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Permissions-Policy / HSTS / X-DNS-Prefetch-Control，**仍缺 `Content-Security-Policy`**
- **待办**: 添加 CSP 头，限制 script-src / style-src / img-src / connect-src；放行 Privy、Sui RPC、Supabase、Walrus、Vercel Blob、Sentry ingest 等外部域名

### 8. 分析/统计 ⬜
- **推荐**: Vercel Analytics（零配置）或 Plausible（隐私友好）
- **安装**: `@vercel/analytics` + `@vercel/speed-insights`
- **文件**: `web/app/layout.tsx` 或 `web/components/providers/app-providers.tsx` 中添加组件
- **2026-04-21 状态**: `web/package.json` 无 `@vercel/analytics` / `@vercel/speed-insights`，未开始

### 9. 响应式修复 ✅（2026-04-21 交付）
- **文件**: `web/components/layout/grid.tsx`
- **原问题**: `colStyles` 硬编码 `grid-cols-2/3/5`，移动端不折叠
- **修复**: 显式映射，所有类名字面量以满足 Tailwind JIT：
  - `cols=2` → `grid-cols-1 sm:grid-cols-2`
  - `cols=3` → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
  - `cols=5` → `grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5`
- **备注**: 当前仓库无组件引用 `Grid`（前瞻性修复），未来引入时移动端即默认折叠

### 10. AUTH_SECRET 和 ADMIN_PASSWORD ⬜
- **问题**: 生产环境需使用随机生成的强密钥，不能沿用 `.env.example` 占位值
- **核查点**:
  - `AUTH_SECRET`（agent claim token 签名）— `.env.example` 已标注 `replace-with-a-random-secret`
  - `ADMIN_PASSWORD`（若仍在使用）— 确认 Vercel env 中已替换
  - 生产环境 `.env` 未提交，需运维在部署目标（Vercel / 后端服务器）分别轮换
- **动作**: 用 `openssl rand -base64 48` 生成，写入 Vercel Dashboard 与后端运行环境

---

## P2 — 上线后迭代（可延后）

### 11. CI/CD 流水线 ⬜（web），✅（desktop 独立）
- `.github/workflows/web-ci.yml` — PR 时自动跑 `npm --prefix web run lint` + `typecheck` + 后端 `npm test`
- Vercel 自带 Preview Deploy，但类型检查和测试需要 CI
- **2026-04-21 状态**: `.github/workflows/` 仅有 `desktop-release.yml`（Desktop Tauri 发布），无 web CI

### 12. 结构化日志
- 后端管线替换 console.log → pino / winston
- 添加请求 ID、关联 ID，方便排障

### 13. Web Vitals 监控
- Vercel Speed Insights 或自建 Core Web Vitals 上报

### 14. 图片优化
- Soul 卡片封面用 `next/image` 替代 CSS backgroundImage
- 配置 `images.remotePatterns` 允许 Walrus 域名

### 15. Move 合约残留项（已确认不阻塞上线）
合约已升级，4 个 HIGH 全部已修复或非问题：
- ~~T-007~~: **已修复** — mint 和 list 已拆分
- ~~T-012~~: **已改进** — `freeze_upgrades` 按值取 UpgradeCap（advisory 治理模式，可接受）
- ~~T-013~~: **已修复** — publish 脚本自动同步 manifest
- ~~T-011~~: **非问题** — 加密状态正确返回，Desktop 不上线
- **T-004**: 无显式重复上架防护（Sui kiosk 层面已阻止，低风险）— 可 v2 迭代

### 17. Web lint 全绿 ✅（2026-04-21 交付）
- **目标**：`npm --prefix web run lint` 输出 0 errors / 0 warnings，避免 CI 新接入时红灯。
- **已完成（全部在既有文件就地改动，无新功能）**：
  - `web/lib/hooks/use-wallet-balances.ts` — 删除渲染期 `currentWalletAddressRef.current =` 写入与 `previousWalletAddressRef.current !==` 读取；staleness 改由单一 `requestVersionRef` 判定（等价于旧双检，因为 useEffect 每次都会 ++requestVersionRef）；`walletChanged` 由 `isCurrentAddress = state.walletAddress === walletAddress` 代替，`useLayoutEffect` 不再需要。
  - `web/components/providers/create-soul-provider.tsx` + `import-soul-provider.tsx` — hydration 改为 React 官方"adjust state during render on prop change"模式，新增 `hydratedForUserId` state 作为门卫，`if (!authLoading && hydratedForUserId !== userId) { ... setState(...) }` 在渲染期触发，首轮命中后自终止。
  - `web/lib/hooks/use-collection-publish.ts` — `clearRecoveryState` 包 `useCallback(..., [])`，加入 `useEffect` 依赖；`useCallback` 加入 react import。
  - `web/lib/hooks/use-wrap-publish.ts` — `publish` useCallback 依赖补 `suiClient`。
  - `web/lib/hooks/use-privy-sui.ts` / `web/app/api/agent/souls/[id]/purchase/route.ts` / `web/app/create/gas/page.tsx`（两处）— 删除无用的 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` 注释（`next/core-web-vitals` preset 未启用该规则）。
  - 7 处 `<img>` → `<Image unoptimized width={N} height={N}>`：`collections/create/preview/page.tsx`（2 处 32/64）、`community/leaderboard/page.tsx`（32）、`wrap-link/personal/{configure,page,preview,success}/page.tsx`（40/48/64/40）。`unoptimized` 直通 blob: / Walrus / IPFS / 任意外部 URL，无需动 `images.remotePatterns`；thumbnail 尺寸下 Next 优化收益接近 0，保持现状 UX。
- **验证**：lint exit 0、typecheck exit 0、`npm test` 957/957 pass（含 `use-wallet-balances` / `publish-provider-hydration` / `create-soul-provider` / `wrap-publish-recovery` 四条相关单测）。
- **遗留**：P2 #14（Soul 卡片封面 CSS backgroundImage → `next/image` + `remotePatterns` 配置 Walrus）与本轮无重叠，仍按原计划 v2 迭代。

### 16. Web ↔ Desktop 发布通道互不影响 ✅（2026-04-21 交付）
- **目标**：Desktop 发布不触发 Web 重部署，Web / 后端 tag 不触发 Desktop 构建，`/download` 指向最新 Tauri release 无需人工更新 env。
- **已完成**：
  - `.github/workflows/desktop-release.yml` — tag 触发器收紧为 `desktop-v*`（原 `v*`），文件头写入 tag 约定（Desktop `desktop-vX.Y.Z` / Web 其它前缀）。
  - `web/scripts/upload-desktop-dmg.ts` — 增加 `desktop/manifest.json` 发布步骤（固定 Blob 路径，`allowOverwrite: true`，`cacheControlMaxAge: 60`）；打印 manifest URL 供一次性写入 Vercel env。
  - `web/app/download/page.tsx` — 改为 async Server Component + `revalidate = 300`，通过 `DESKTOP_MANIFEST_URL` fetch manifest；manifest 失败时 graceful fallback 到旧 `NEXT_PUBLIC_DESKTOP_*` env，两者都缺则显示 "Build coming soon"。
  - `.env.example` — 新增 `DESKTOP_MANIFEST_URL`，两个旧 env 注释改为 fallback。
- **运维约定**（写入 yaml / 脚本 / env 文档三处）：
  - Desktop 发版打 `desktop-vX.Y.Z` tag，CI 产出 macOS / Windows 资产 + GitHub Release。
  - 同时运行 `npx tsx web/scripts/upload-desktop-dmg.ts <dmg>` 上传 dmg + manifest。
  - 首次完成后 **一次性** 把 manifest URL 写入 Vercel Production env `DESKTOP_MANIFEST_URL`，之后每次发版 0 次 Web redeploy。

---

## 执行顺序建议（2026-04-21 再更新）

```
剩余 P0:   #1 Vercel 配置 + #5 Sentry + #6 后端部署方案
          （#2 TS ✅ / #3 SEO ✅ / #4 法律页面 ✅ 已完成）
剩余 P1:   #7 CSP + #8 Analytics + #10 密钥轮换（#9 Grid 响应式 ✅ 已完成）
后续迭代:  P2（Web CI 建议提前一起落）
```

## 验证清单

- [x] `next build` 零 TS 错误通过（2026-04-21：`npm --prefix web run typecheck` exit 0）
- [x] `robots.ts` / `sitemap.ts` 已生成（2026-04-21：Next 自动路由，部署后 `/robots.txt` `/sitemap.xml` 即可访问）
- [x] 法律页面 `/terms` 和 `/privacy` 可访问，footer 有入口（2026-04-21：`site-footer.tsx` 已接入 `app-shell.tsx`）
- [x] OG/Twitter/icons metadata 已配置，默认 OG 图走 `opengraph-image.tsx` ImageResponse，Soul / Post 详情页有动态 OG（2026-04-21）
- [ ] Vercel Preview Deploy 成功，主要页面可访问（同时在 Preview URL 用 Twitter Card Validator / OpenGraph.xyz 抽检默认 OG + 任意 `/souls/[id]` 动态 OG）
- [ ] Sentry 测试错误可在 dashboard 看到
- [ ] 后端管线在目标环境正常运行（采集→生产→发布）
- [x] `Grid` 组件移动端默认折叠至 `grid-cols-1`（2026-04-21：显式映射已落地；市场页若后续接入 `Grid` 即享受折叠，目前实际市场页用自定义类名需另行复核）
- [ ] 生产环境密钥已轮换（AUTH_SECRET、ADMIN_PASSWORD，及其它在 `.env.example` 标注为 `replace-with-*` 的变量）
- [x] Desktop 发布通道与 Web 上线互不影响（2026-04-21：tag 前缀 `desktop-v*` 隔离 GA 触发；`/download` 通过 `DESKTOP_MANIFEST_URL` + ISR 读取 Vercel Blob manifest，Desktop 发新版 0 次 Web redeploy）
- [x] `npm --prefix web run lint` 0 errors / 0 warnings（2026-04-21：4 个 React hook 错误 + 2 个 exhaustive-deps 警告 + 3 个 unused eslint-disable + 7 个 `<img>` 警告全部修复，`npm test` 957/957 pass，详见 #17）

## 关键文件清单

| 文件 | 操作 | 2026-04-21 状态 |
|------|------|-----------------|
| `web/next.config.ts` | 修改（CSP、Sentry 包裹、Analytics） | 🟡 TS 修复已做；CSP / Sentry / Analytics 未做 |
| `web/app/layout.tsx` | 修改（完整 metadata） | ✅ 已完成（metadataBase、OG、Twitter、robots、viewport、icons） |
| `web/app/opengraph-image.tsx` | 新建 | ✅ 已完成（`next/og` ImageResponse） |
| `web/app/apple-icon.tsx` | 新建 | ✅ 已完成（`next/og` 180×180 PNG） |
| `web/app/robots.ts` | 新建 | ✅ 已完成 |
| `web/app/sitemap.ts` | 新建 | ✅ 已完成（静态 + listed souls + collections + published posts，`revalidate=3600`） |
| `web/app/market/layout.tsx` | 新建 | ✅ 已完成（静态 metadata 套在客户端页面外） |
| `web/app/community/layout.tsx` | 新建 | ✅ 已完成 |
| `web/app/souls/[id]/layout.tsx` | 新建 | ✅ 已完成（`generateMetadata()` 动态 OG） |
| `web/app/community/posts/[id]/layout.tsx` | 新建 | ✅ 已完成（`generateMetadata()`，未发布 post 自动 `noindex`） |
| `web/app/terms/page.tsx` | 新建 | ✅ 已完成（13 节服务条款） |
| `web/app/privacy/page.tsx` | 新建 | ✅ 已完成（12 节隐私政策） |
| `web/components/layout/site-footer.tsx` | 新建 | ✅ 已完成 |
| `web/components/layout/app-shell.tsx` | 修改（挂 footer） | ✅ 已完成 |
| `web/components/layout/grid.tsx` | 修改（响应式） | ✅ 已完成（`grid-cols-1 sm:… lg:…` 显式映射，JIT 友好） |
| `.github/workflows/desktop-release.yml` | 修改（tag 前缀隔离） | ✅ 已完成（`desktop-v*` 触发器，头部写入 tag 约定） |
| `web/scripts/upload-desktop-dmg.ts` | 修改（发布 manifest） | ✅ 已完成（固定 Blob 路径 `desktop/manifest.json`） |
| `web/app/download/page.tsx` | 修改（ISR 读 manifest） | ✅ 已完成（async Server Component，`revalidate = 300`，graceful fallback） |
| `.env.example` | 修改（新增 `DESKTOP_MANIFEST_URL`） | ✅ 已完成 |
| `web/lib/hooks/use-wallet-balances.ts` | 修改（去除渲染期 ref 读写） | ✅ 已完成（`react-hooks/refs` 2 个 errors 清零） |
| `web/components/providers/create-soul-provider.tsx` / `import-soul-provider.tsx` | 修改（hydration 改渲染期 prop-change 模式） | ✅ 已完成（`react-hooks/set-state-in-effect` 2 个 errors 清零） |
| `web/lib/hooks/use-collection-publish.ts` | 修改（`clearRecoveryState` 包 `useCallback` + 加 dep） | ✅ 已完成 |
| `web/lib/hooks/use-wrap-publish.ts` | 修改（补 `suiClient` dep） | ✅ 已完成 |
| `web/lib/hooks/use-privy-sui.ts` / `web/app/api/agent/souls/[id]/purchase/route.ts` / `web/app/create/gas/page.tsx` | 修改（删 3 条无用 `@typescript-eslint/no-explicit-any` disable） | ✅ 已完成 |
| 7 × `<img>` → `<Image unoptimized>` | 修改（`collections/create/preview` × 2、`community/leaderboard`、`wrap-link/personal/{configure,page,preview,success}` × 4） | ✅ 已完成（`@next/next/no-img-element` 7 个 warnings 清零） |
| `vercel.json` | 新建 | ⬜ |
| `.github/workflows/web-ci.yml` | 新建（P2，可提前） | ⬜（仅有 `desktop-release.yml`） |
| `sentry.{client,server,edge}.config.ts` | 新建 | ⬜ |
