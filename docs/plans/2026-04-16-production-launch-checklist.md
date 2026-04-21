# ClawNews 正式上线准备计划

> 2026-04-16 · 最近复核 **2026-04-21**

## Context

ClawNews 需要从开发阶段过渡到正式上线。上线范围：**Web 端（Soulidity Soul 市场 + 社区）+ 后端新闻管线（采集→LLM 加工→Telegram 发布）+ Desktop（Tauri）客户端独立发布**。Web 端部署平台：**Vercel**。

当前状态：核心功能已完整（75+ API 端点、135+ 测试文件、多策略认证、完整的后端管线），但缺少上线必备的基础设施配置（SEO、法律页面、监控、部署配置等）。

Move 合约已升级，4 个 HIGH 级问题全部已修复或非问题，不阻塞上线。

### 2026-04-21 复核要点

- `new-web/` 已合并回 `web/`，所有上线改动落在 `web/app/`、`web/components/`、`web/next.config.ts`。CLAUDE.md 仍残留 `new-web` 引用，属文档 drift，不阻塞上线。
- 新增 Desktop（Tauri）客户端，独立发布通道见 `.github/workflows/desktop-release.yml` + `web/app/download/`；Desktop 不在 Vercel 发布链路，仅列作并行工作流。
- 下文各项前的状态标签（✅ 已完成 / 🟡 部分完成 / ⬜ 未开始）反映 2026-04-21 仓库实际状态。

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

### 9. 响应式修复 ⬜
- **文件**: `web/components/layout/grid.tsx`
- **问题**: `colStyles` 仍硬编码 `grid-cols-2/3/5`，移动端不折叠
- **修复**: 改为 `grid-cols-1 sm:grid-cols-2 lg:grid-cols-{cols}` 形式（注意 Tailwind JIT 需完整类名，考虑显式映射）

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

---

## 执行顺序建议（2026-04-21 再更新）

```
剩余 P0:   #1 Vercel 配置 + #5 Sentry + #6 后端部署方案
          （#2 TS ✅ / #3 SEO ✅ / #4 法律页面 ✅ 已完成）
剩余 P1:   #7 CSP + #8 Analytics + #9 Grid 响应式 + #10 密钥轮换
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
- [ ] 移动端市场页面布局正常（Grid 响应式修复后）
- [ ] 生产环境密钥已轮换（AUTH_SECRET、ADMIN_PASSWORD，及其它在 `.env.example` 标注为 `replace-with-*` 的变量）
- [ ] Desktop 发布通道与 Web 上线互不影响（`/download` 页面指向最新 Tauri release）

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
| `web/components/layout/grid.tsx` | 修改（响应式） | ⬜ 仍硬编码 `grid-cols-3` |
| `vercel.json` | 新建 | ⬜ |
| `.github/workflows/web-ci.yml` | 新建（P2，可提前） | ⬜（仅有 `desktop-release.yml`） |
| `sentry.{client,server,edge}.config.ts` | 新建 | ⬜ |
