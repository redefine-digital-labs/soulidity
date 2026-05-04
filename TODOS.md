# TODOs

延伸工作清单。本轮（2026-05-04 typed-content nebula plan）产生但显式不在 scope 内的工作。
每条 TODO 必须保留 What / Why / Pros / Cons / Context / Depends on 六字段；缺字段就不是 TODO，是垃圾。

---

## T1 — `grant.move` 增加独立 scope 位以拆分 sprite / audio 授权（**产品分支项 — 非必做**）

**What**: 在 `grant.move` 中新增独立 scope bit（如 `SCOPE_AUDIO = 16`），让"授权 agent 听音色但不能换 sprite"成为可能。同步给 `KindRegistry` 提供"自定义 kind 也可以拥有独立 scope"的能力。

**Why**: 当前 `KindDescriptor.default_grant_scope_mask` 必须恰好是 `SCOPE_SKILLS` 或 `SCOPE_ASSETS` 二选一。Sprite 和 Audio 都被绑在 `SCOPE_ASSETS` 上，无法分离细粒度授权。Voice 是产品上的强差异化能力（agent 用音色身份代理用户），但当前权限模型把它和 sprite 混为一谈。

**Status**: 这不是 phase 2 的技术债，而是**产品决策项**。从语义看 `assets = sprite + audio` 是合理的"persona 资产伞"，把 sprite/audio 合并授权对 99% 场景是正确设计。只有当产品上确认存在"音色独立授权"的真实需求（如 agent 代理用户音色但不允许换形象）时才启动。在产品决策前不应被视为待办。

**Pros**（仅在产品需要时才成立）:
- 解锁"授权听不授权改"细粒度场景。
- 为未来 video / 3D / biometric 等 kind 独立 scope 铺路（不再受 skills/assets 二选一约束）。
- 让 typed-content nebula 的 "admin 一笔注册新 kind" 真正完整——独立 scope 才是新 kind 的真正自由。

**Cons**:
- 又一次 ABI break + 重审计 + multisig cap handoff（成本与本轮 typed-content 相当）。
- `grant.move` 现有所有 scope-mask 校验路径都要扩展并回归。
- 已有 grant 的兼容策略需重新设计（按本仓库习惯：hard cut 不迁移）。
- **过早启动会被产品打回**：在没有"音色独立授权"用例的情况下做这次 ABI break，纯粹是技术上的洁癖。

**Context**: 本轮 plan §Why §Known Limit 第 1 条明列。typed-content nebula 落地后，添加新 kind 已能跳过 ABI break，但只要它需要独立 scope，就还得发包。Move 中新增 scope bit 不复杂，复杂在所有调用方（前端 grant builder、API、mirror、UI）都要识别。

**Depends on / blocked by**: **产品决策**——确认存在"sprite / audio 独立授权"或"未来某 kind 需要不在现有 4 个 scope 范畴的独立位"的真实用例。在此之前不启动。

---

## T3 — `register_kind` admin UI

**What**: 在 admin dashboard 中加一个 "Register new content kind" 表单：
- 输入：`name`、`hasActiveBinding`、`requiresDownloadPolicy`、`defaultGrantScopeMask`（下拉 SCOPE_SKILLS / SCOPE_ASSETS）。
- 流程：multisig 钱包签名 → 发送 `register_kind` PTB → 等链上确认 → 同步 `kindDescriptors` 缓存 → toast "Kind '{name}' (id={id}) registered"。
- 同时显示当前 registry 状态：所有已注册 kind 的列表、deprecated 标志、注册时间、注册人地址。
- "Deprecate" 按钮：标记 kind 为 deprecated（不允许新 append）。
- "Reactivate" 按钮：取消 deprecated 标志。

**Why**: 本轮已实现 `buildRegisterKindTx` builder，但没有界面入口。真要注册 video / 3D / prompt 等新 kind 时，admin 必须手敲 TS 调 builder，签名也得手工组装 multisig PTB——容易出错（写错 scope mask、传错 cap id）。一个表单能省 30 分钟、避免一次错注册（错注册=又一次 ABI 升级）。

**Pros**:
- 把 typed-content 的 "30 秒注册新 kind" 真正变成 30 秒。
- 自带审计日志（谁注册了什么 kind、什么时候）。
- registry 状态可视化，便于排错。

**Cons**:
- multisig 签名流程在 web UI 上复杂（涉及多个签名收集、状态机、超时处理）；ClawNews 当前没有现成的 multisig UI 组件。
- admin 权限模型需要新增"可见 KindAdminCap"判断（基于 `ADMIN_EMAILS` env？还是基于 wallet 是否在 multisig 成员列表？）。

**Context**: 本轮 plan §TS / Hook / API §`web/lib/soulidity/tx/kind-registry.ts` 已交付 builder。Admin tooling 在 `web/app/admin/` 现有结构下加新页面 `/admin/kinds`。当前 admin 页面已有 article / tweet / member / invite 管理；kind registry 是新一类资源。

**Depends on / blocked by**: typed-content nebula 落地后；不阻塞落地本身，但落地后第一次想加新 kind 时就需要它。

---

## T4 — Cross-package `requireCurrentPackageId` 的 Prisma middleware 替代方案

**What**: 当前方案（本轮 D2=A 已采纳）是"集中工厂 + ESLint 规则"双重护栏。考虑替代/补充方案：用 Prisma middleware（`prisma.$use`）在 query 层自动注入 `packageId = currentDeployment.packageId` 过滤，对所有 `SoulAsset` / `SoulCollectionAsset` / `SoulPaidAccessRecord` 等 Soul 相关 model 自动应用。开发者写 `prisma.soulAsset.findMany({...})` 也能拿到正确过滤结果。

**Why**: 集中工厂依赖开发者 import + ESLint 兜底。如果有人 disable lint、写 `// eslint-disable-next-line`、或者在新代码路径忘 import 工厂，仍可能漏。Prisma middleware 是底层兜底，"忘了 filter"在 middleware 层永远不会发生。

**Pros**:
- 真正零认知成本——开发者按习惯写 prisma 调用就对。
- 防御深度叠加：工厂 + lint + middleware 三层。
- 有助于跨 package 数据隔离的未来场景（如 staging vs prod 同 DB）。

**Cons**:
- Prisma middleware 在 v5+ 已 deprecated（被 Client Extensions 替代）。需要用 `$extends` 重写所有 Soul-related model 的 query operation，工作量比 middleware 多。
- 自动注入 filter 会让 "故意跨 package 查询"（如审计场景）变成 anti-pattern——必须显式 opt-out（例如 `prisma.$soulRaw.findMany`），增加 API 表面。
- 如果 middleware 与工厂两套机制并存，有 "filter 注入两次" 的潜在 bug；要么删工厂、要么 middleware 检测工厂调用并跳过（额外复杂度）。

**Context**: 本轮 D2 选 A 方案（工厂 + ESLint）。这是 80/20 权衡——工厂能挡住 95% 误用，ESLint 兜底剩下的 5%。Middleware 是更彻底的 100%。是否值得加这层防御取决于：(a) 团队规模和新人开发频率；(b) 跨 package 查询是否还会出现在审计/数据治理场景。

**Depends on / blocked by**: 不依赖 typed-content nebula 本轮。可在 nebula 落地后任何时间补。建议先观察工厂 + ESLint 实际拦截率，再判断是否升级到 middleware。
