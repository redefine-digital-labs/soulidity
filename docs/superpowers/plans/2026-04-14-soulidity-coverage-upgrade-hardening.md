# Soulidity Coverage And Upgrade Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理 `content_access` 错误码尾巴，并补齐重入验证、升级预留、覆盖率证据，以及可执行的暂停/锁定回滚方案。

**Architecture:** `content_access` 错误码按最新要求改为连续编号，并同步收口所有引用与文档。新增治理逻辑复用 `MarketAdminCap` 与 Sui package capability 模型，不引入额外代理层。回滚方案复用现有 `paused` 与 `freeze_upgrades` 两级开关。验证优先依赖 Move 单测与 fresh 工具输出。

**Tech Stack:** Sui Move 2024.beta, `sui move test`, repo docs

---

### Task 1: 错误码尾巴收口

**Files:**
- Modify: `move/soulidity/sources/content_access.move`
- Modify: `docs/plans/2026-04-11-soul-assets-and-content-access-plan.md`

- [x] 标记 `content_access` 中错误码编号调整策略
- [x] 删除或改写文档中仍声明旧错误码与旧支付断言的片段
- [x] 复查仓库，确认无运行时代码再引用旧错误码

### Task 2: 重入验证补齐

**Files:**
- Modify: `move/soulidity/sources/protocol_tests.move`
- Reference: `move/soulidity/sources/market.move`

- [x] 识别最能证明“无回调重入面”的关键入口
- [x] 新增对应测试，证明同一交易流里不存在可重入的状态穿透
- [x] 运行相关过滤测试并确认通过

### Task 3: 升级预留机制补齐

**Files:**
- Modify: `move/soulidity/sources/market.move`
- Modify: `move/soulidity/sources/protocol_tests.move`
- Modify: `move/soulidity/Published.toml` only if verification evidence requires it

- [x] 明确升级治理对象与 admin cap 的关系
- [x] 为升级治理状态新增最小实现
- [x] 为 admin 控制、状态查询、边界失败路径补测试
- [x] 运行相关过滤测试并确认通过

### Task 4: 覆盖率证据与总验证

**Files:**
- Modify only if tool/bootstrap support is needed

- [x] 尝试获取支持 `tracing` 的覆盖率工具链
- [x] 若成功，运行 `sui move test --coverage` 与 `sui move coverage summary`
- [x] 若失败，保留失败证据并执行全量 `sui move test`
- [x] 汇总结果，明确达标/未达标/阻塞项

### Task 5: 回滚方案与 Gas 验收口径

**Files:**
- Modify: `docs/superpowers/specs/2026-04-14-soulidity-coverage-upgrade-hardening-design.md`
- Reference: `move/soulidity/sources/market.move`

- [x] 基于现有 `update_paused` / `freeze_upgrades` 输出可执行 runbook
- [x] 区分可逆暂停与不可逆锁定的操作边界
- [x] 记录用户确认的 Gas 结论：主网费用可接受
