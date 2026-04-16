# ClawNews 正式上线准备计划

> 2026-04-16

## Context

ClawNews 需要从开发阶段过渡到正式上线。上线范围：**Web 端（Soulidity Soul 市场 + 社区）+ 后端新闻管线（采集→LLM 加工→Telegram 发布）**。部署平台：**Vercel**。

当前状态：核心功能已完整（75+ API 端点、135 个测试文件、多策略认证、完整的后端管线），但缺少上线必备的基础设施配置（SEO、法律页面、监控、部署配置等）。

Move 合约已升级，4 个 HIGH 级问题全部已修复或非问题，不阻塞上线。

---

## P0 — 上线阻塞项（必须完成）

### 1. Vercel 部署配置
- **文件**: 新建 `vercel.json`，确认 `web/` 为 root directory
- **环境变量**: 在 Vercel Dashboard 配置所有 `.env.example` 中的变量（数据库、Privy、Sui、Supabase、Telegram 等）
- **Build 命令**: `cd web && npm run build`（已有 `prisma:generate && next build --webpack`）
- **验证**: Vercel Preview Deploy 成功 + 主要页面可访问

### 2. 修复 TypeScript 构建
- **文件**: `web/next.config.ts:24`
- **问题**: `ignoreBuildErrors: true` 会让类型错误静默通过
- **动作**: 关闭 `ignoreBuildErrors`，修复所有 TS 编译错误，确保 `next build` 干净通过
- **风险**: 可能有较多类型错误需要修复，需先评估数量

### 3. SEO 基础
- **新建文件**:
  - `web/app/robots.ts` — 生成 robots.txt（允许爬虫、指向 sitemap）
  - `web/app/sitemap.ts` — 动态 sitemap（市场页、Soul 详情页、社区帖子）
  - `web/public/favicon.ico` + `web/public/apple-touch-icon.png`
- **修改文件**:
  - `web/app/layout.tsx` — 补充 `openGraph` + `twitter` metadata、icons 配置
  - Soul 详情页 — 添加 `generateMetadata()` 动态 OG 标签（标题、描述、封面图）

### 4. 法律页面
- **新建**:
  - `web/app/terms/page.tsx` — 服务条款
  - `web/app/privacy/page.tsx` — 隐私政策
- **内容**: 基于 Web3 / 数字内容市场模板生成，覆盖加密钱包、链上交易、内容许可等条款
- **导航**: 在 footer 中添加链接

### 5. 错误监控（Sentry）
- **安装**: `@sentry/nextjs`
- **配置**: `sentry.client.config.ts` + `sentry.server.config.ts` + `sentry.edge.config.ts`
- **修改**: `web/next.config.ts` 包裹 `withSentryConfig`
- **目标**: 生产环境错误自动上报 + source map 上传

### 6. 后端部署方案
- 后端管线（scheduler + Telegram bot）不跑在 Vercel 上
- **选项 A**: 现有服务器 `pm2` 运行 `npm run dev`
- **选项 B**: Fly.io / Railway 容器化部署
- **最少需要**: 确认后端在哪里跑、进程管理方式、日志收集

---

## P1 — 上线前强烈建议（影响体验和安全）

### 7. Content-Security-Policy 安全头
- **文件**: `web/next.config.ts` securityHeaders 数组
- **动作**: 添加 CSP 头，限制 script-src / style-src / img-src / connect-src
- **注意**: 需要允许 Privy、Sui RPC、Supabase、Walrus 等外部域名

### 8. 分析/统计
- **推荐**: Vercel Analytics（零配置）或 Plausible（隐私友好）
- **安装**: `@vercel/analytics` + `@vercel/speed-insights`
- **文件**: `web/app/layout.tsx` 或 `app-providers.tsx` 中添加组件

### 9. 响应式修复
- **文件**: `web/components/layout/grid.tsx`
- **问题**: 硬编码 `grid-cols-3`，移动端不折叠
- **修复**: 改为 `grid-cols-1 sm:grid-cols-2 lg:grid-cols-${cols}`

### 10. AUTH_SECRET 和 ADMIN_PASSWORD
- **问题**: `.env` 中 `AUTH_SECRET="clawnews-secret-change-in-production"` 和 `ADMIN_PASSWORD="changeme"` 是占位符
- **动作**: 生产环境使用随机生成的强密钥

---

## P2 — 上线后迭代（可延后）

### 11. CI/CD 流水线
- `.github/workflows/web-ci.yml` — PR 时自动跑 lint + type check + test
- Vercel 自带 Preview Deploy，但类型检查和测试需要 CI

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

## 执行顺序建议

```
第一轮（基础设施）: P0 #1 Vercel 配置 + #2 TS 修复 + #6 后端部署方案
第二轮（合规 & 安全）: P0 #3 SEO + #4 法律页面 + #5 Sentry + P1 #10 密钥轮换
第三轮（体验优化）:   P1 #7 CSP + #8 分析 + #9 响应式
后续迭代:            P2 项按需排入
```

## 验证清单

- [ ] `next build` 零 TS 错误通过
- [ ] Vercel Preview Deploy 成功，主要页面可访问
- [ ] OG 标签在社交媒体预览正确展示
- [ ] robots.txt / sitemap.xml 可访问
- [ ] Sentry 测试错误可在 dashboard 看到
- [ ] 法律页面 /terms 和 /privacy 可访问
- [ ] 后端管线在目标环境正常运行（采集→生产→发布）
- [ ] 移动端市场页面布局正常
- [ ] 生产环境密钥已轮换（AUTH_SECRET、ADMIN_PASSWORD）

## 关键文件清单

| 文件 | 操作 |
|------|------|
| `web/next.config.ts` | 修改（TS 错误、CSP、Sentry） |
| `web/app/layout.tsx` | 修改（metadata、analytics） |
| `web/app/robots.ts` | 新建 |
| `web/app/sitemap.ts` | 新建 |
| `web/app/terms/page.tsx` | 新建 |
| `web/app/privacy/page.tsx` | 新建 |
| `web/components/layout/grid.tsx` | 修改（响应式） |
| `vercel.json` | 新建 |
| `.github/workflows/web-ci.yml` | 新建（P2） |
| Soul 详情页 | 修改（动态 metadata） |
