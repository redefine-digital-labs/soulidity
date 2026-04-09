# Confirmo Sprites 逆向调研与复刻方案

## Goal

基于公开可观察信息，对 `https://sprites.confirmo.love/` 做一次面向“同类产品复刻”的逆向调研，并输出一份可直接指导实现的技术分析方案。重点不是复述页面，而是给出可落地的产品拆解、系统架构、数据模型、核心机制、MVP 路径、成本与风险判断。

## Scope

- 站点产品面：`/`, `/explore`, `/search`, `/sprite/:id`, `/upload`, `/device`, `/avatar`, `/user/:id`, `/settings`, `/arena`, `/admin`, `/admin/users`, `/admin/stats`, `/auth/callback`
- API 面：`/auth/*`, `/sprites*`, `/comments*`, `/likes*`, `/users*`, `/follows*`, `/notifications*`, `/arena/rooms*`, `/admin/*`, `/stats/pageview`
- 实时链路：`wss://api.sprites.confirmo.love/arena/rooms/{room}/ws`
- 资源分发链路：`pub-sprites.confirmo.love`
- 桌面端联动：`confirmo://arena?room=...`、`/auth/device/complete`
- 输出重点：
  - 产品与功能拆解
  - 系统架构与技术栈推测
  - 核心实现机制分析
  - 数据流、扩展性、安全
  - 从 0 复刻的工业级技术方案
  - 成本、风险、可行性评估

## Key Facts

以下为当前已确认的高置信事实，用于约束最终方案：

- 前端是 React 18 单页应用，根入口是 Vite 构建产物 `/assets/index-CUZhnl5F.js`
- 前端使用 React Router；公开能看到探索、搜索、详情、上传、用户页、设置、设备绑定、Arena、管理后台等完整路由
- 前端使用 TanStack Query 风格查询管理，Arena 房间列表有 10 秒轮询
- API 基础域名为 `https://api.sprites.confirmo.love`
- API 根返回 `{"status":"ok","service":"confirmo-community-api","migrations":"10 migrations applied"}`
- API 明确暴露了资源型 REST 接口：sprites、users、comments、likes、follows、notifications、arena、admin
- 精灵上传不是文件直传到业务 API，而是“申请 upload URLs -> PUT 到预签名地址 -> finalize”的对象存储直传模式
- 精灵资源静态托管在 `https://pub-sprites.confirmo.love/sprites/{id}/...`
- Arena 观战采用 WebSocket，前端消息类型至少包含 `join / ping / welcome / state / event / replay / error`
- Arena 回放在前端本地有 replay player，支持 pause / resume / speed / seek / restart
- 桌面端通过自定义协议 `confirmo://arena?room=...` 拉起加入战斗
- 设备绑定页面通过 `/auth/device/complete` 完成账号与桌面端关联
- 登录链路包含 Google OAuth callback、access token、refresh token、`/auth/me`
- `Avatar Studio` 虽然存在，但前端文本已明确“real 3D generation is not implemented yet”，当前更像 demo rig / pose / export 流程，而不是已上线的 AI 3D 生成能力

## Acceptance

1. 最终报告必须明确区分：
   - 已观察事实
   - 基于证据的推断
   - 推荐复刻方案
2. 报告必须覆盖以下结构：
   - 产品与功能拆解
   - 系统架构推测
   - 技术栈推测
   - 关键实现机制拆解
   - 数据流与交互设计
   - 性能与扩展性设计
   - 安全与风控
   - 从 0 实现的技术方案
   - 成本评估
   - 风险与难点分析
3. 报告必须写清公开接口边界、匿名与登录边界、管理员边界、实时链路边界
4. 报告必须给出表级别数据库设计，至少覆盖：
   - `users`
   - `sprites`
   - `sprite_assets`
   - `comments`
   - `likes`
   - `follows`
   - `notifications`
   - `review_tasks`
   - `arena_rooms`
   - `arena_events`
   - `device_links`
   - `pageview_stats`
5. 报告必须给出可执行的 MVP 路线和阶段优先级，而不是只给理想化终态架构
6. 对不确定部分必须标注“推测 + 理由”，不能把推测写成事实

## Plan

### 1. 产品拆解

- 按用户视角拆成九个能力域：
  - 浏览发现
  - 详情互动
  - 上传发布
  - 个人主页
  - 通知
  - 设备绑定
  - Pixel Arena 实时观战
  - 管理后台
  - 3D Avatar 扩展
- 按系统视角拆成六个领域：
  - 内容域
  - 社交域
  - 身份域
  - 审核域
  - 实时对战域
  - 统计域

### 2. 架构推测

- 当前站点高概率是“前端 SPA + 独立 API + 对象存储 + WebSocket 实时层”的结构
- 当前后端高概率为 TypeScript 模块化单体，或轻量拆分成 API 服务 + Arena 实时服务
- 边缘层前面有 Cloudflare；静态站和静态资源都经过 Cloudflare 分发
- 复刻时默认推荐：
  - Web：Next.js App Router，公开详情页与 SEO 相关页面走 SSR/ISR，应用交互区走客户端 hydration
  - API：Fastify + TypeScript + Zod
  - 实时：独立 WebSocket gateway
  - 数据：PostgreSQL + Redis + S3/R2
  - 异步：队列处理图片派生、审核任务、统计聚合

### 3. 核心机制

- 精灵上传链路按工业级方案设计：
  - 浏览器提交文件元信息
  - 服务端签发预签名上传地址
  - 客户端直传对象存储
  - 服务端 `finalize` 校验文件、入库、生成缩略图/GIF/zip 元数据
  - 审核通过后公开展示
- Arena 观战链路按“双通道”设计：
  - HTTP 轮询拿房间列表
  - WebSocket 加入房间订阅实时状态与事件流
  - 服务端按房间广播状态快照和增量事件
  - 前端本地 replay player 做时间轴回放
- 认证链路按“浏览器登录 + 桌面绑定”双路径设计：
  - Google OAuth 获取用户身份
  - access token + refresh token 管理会话
  - 设备码/用户码把 Web 登录态转移给桌面端
- 社区链路按标准内容社区模型设计：
  - sprites
  - comments
  - likes
  - follows
  - notifications
  - admin moderation

### 4. 报告实现重点

- 技术栈推测必须具体到：
  - React 18
  - React Router
  - TanStack Query
  - Tailwind/Radix/shadcn 风格组件栈
  - Three.js（Avatar Studio）
  - Node.js/TypeScript 后端高概率
- API 设计要明确写成 REST 风格，而不是 GraphQL/RPC
- 交互模式要明确区分：
  - 当前站点主应用是 CSR
  - 推荐复刻方案可改为“公开页 SSR/ISR + 交互区 CSR”
- 安全风控默认写入：
  - OAuth 登录
  - JWT / refresh token
  - 管理员 RBAC
  - 上传文件校验
  - 内容审核状态机
  - 限流与基础反滥用

### 5. 落地方案

- 默认推荐的复刻技术选型：
  - 前端：Next.js 15 + React 19（或与团队现状对齐的稳定版本）+ TanStack Query + Tailwind CSS + shadcn/ui
  - 后端：Fastify + TypeScript + Zod + Prisma
  - 数据库：PostgreSQL
  - 缓存：Redis
  - 对象存储：Cloudflare R2 或 AWS S3
  - 队列：BullMQ / Redis Streams
  - 实时：WebSocket gateway
  - 身份：Google OAuth
- MVP 阶段顺序：
  1. 浏览、详情、上传、用户系统
  2. 评论/点赞/关注/通知
  3. 审核后台
  4. Arena 房间列表 + 观战
  5. 桌面端绑定
  6. Avatar Studio 扩展
- 成本评估默认分为两档：
  - 初期 MVP
  - 增长期

## Assumptions

- 本次文档服务于“做一个可上线的同类产品”，不是收购尽调或纯竞品策略分析
- 只基于公开网页、公开接口、静态资源和被动请求做判断，不包含登录后私有能力的深度验证
- 不逆向桌面客户端内部实现，只围绕网页端暴露的协议与接口设计联动方案
- `Avatar Studio` 当前不纳入 MVP 必选项，只作为成熟阶段扩展能力
