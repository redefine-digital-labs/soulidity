# Soulidity Phase Handoff: unified-maker-v8-market-release

## Snapshot

- Created: 2026-08-21T08:28:36+08:00
- Phase: unified-maker-v8-market-release
- Status: complete
- Goal: 完成 fresh v8 typed Market listing、真实 child custody、purchase、cancel、recovery 与 exact settlement，并以测试、字节码门禁和独立审计冻结可恢复提交
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/20260821-082836-unified-maker-v8-market-release.md`

## Outcome

Maker、Soul 三件套、Base Physical 与 Pack Physical 的完整 typed Market 链路已落地；所有授权来自真实对象、TypeOrigin、call-cap、parent Receiving 与不可伪造 ticket，结算和生命周期语义通过全量验证及两路独立 No P0/P1 审计。实现冻结于 durable integration worktree 的 commit 4627d3f232004150c3601d380cec6fcccea2b919。

## Scope and non-goals

### In scope

- Maker、Soul、Base Physical、Pack Physical typed listing/custody/purchase/cancel/recovery
- exact protocol、creator、source 与 seller split，strict payment、u128 rounding、replay/parent/epoch/content checks
- 七包 tests、adversarial runners、force disassembly、size gates 与两路独立 P0/P1 audit

### Intentionally not done

- compiler、recovery tooling 与 web 实现
- GitHub、Vercel、签名、广播、Mainnet 或任何外部发布
- v4-v7 compatibility、migration、fallback 或 dual path

## Durable decisions

- Market authorization 只接受 live typed objects、exact TypeOrigin/call-cap/catalog/root/content/epoch 与真实 Receiving parent，不接受 caller-supplied ID、boolean 或 pure hash 作为 authority。
- Soul custody 是 Output、Receipt、Soul 不可拆三件套；content commitments 绑定 original holder，current holder 仅在成功购买时原子更新，Soul ownership epoch 恰好加一。
- Maker healthy PAUSED listing 允许 buyer purchase 或 seller cancel；permissionless recovery 仅限 archived、protocol disabled 或 binding drift，避免第三方稳定 grief。Soul/Physical 才支持 PAUSED/ARCHIVED recovery。
- Core 64,000 B 自设目标保持不变，最终 package object 63,918 B，仅余 82 B；后续优先 companion，不得无证明增加 Core 生产字节码。

## Changed paths and assets

### Changed paths

- docs/codex/MARKET_V8_RELEASE_SPEC.md
- docs/codex/MARKET_V8_RELEASE_PLAN.md
- move/animacraft_v8_core
- move/animacraft_v8_output
- move/animacraft_v8_physical
- move/animacraft_v8_market

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- 4627d3f232004150c3601d380cec6fcccea2b919

## Verification

- 七包 sui move test --warnings-are-errors：Core 70、Seal 28、Runtime 30、Output 43、Physical 63、Market 15、Release 14，共 263 tests，全部通过 — PASS
- 七包 adversarial runners 全部通过；Output 8、Physical 15、Market 8 个真实 ABI/攻击 probes 均按精确诊断 expected-fail — PASS
- 七包 force disassembly 与 size gates：Core 63,918/64,000；Seal 18,814/75,000；Runtime 52,431/90,000；Output 36,955/90,000；Physical 37,924/55,000；Market 26,069/55,000；Release 7,396/25,000 — PASS
- 独立 authorization audit 与 settlement/lifecycle audit 均结论 No P0/P1；目标 worktree post-commit clean，diff-tree check — PASS

## Risks and recovery

### Risks or blockers

- Core 自设目标仅余 82 B，任何后续 Core production hook 必须先证明不可避免并同时腾挪字节。
- 本阶段未实现或验证 compiler、recovery tooling、web、GitHub、Vercel、签名、广播或 Mainnet，产品尚未达到用户可直接使用状态。

### Recovery or rollback points

- durable integration branch codex/unified-maker-v8-resume at 4627d3f232004150c3601d380cec6fcccea2b919 in /Users/naoer/Documents/Claude/Projects/soulidity/tmp/animacraft-unified-v8-resume；起点 d62bcffa92eca065dad1bee534c5019c0bf8507f，回滚须保留用户工作且不得使用破坏性 reset。

### Working-tree evidence

```text
 M .gitignore
 M CONTEXT.md
 M README.md
?? .pnpm-store/
?? AGENTS.md
?? clawnews/
?? docs/
?? live-portrait.html
?? scripts/
```

## Exact next action

仅从本 handoff 与 commit 4627d3f232004150c3601d380cec6fcccea2b919 启动下一独立 bounded phase：实现并验证 fresh-v8-only compiler、recovery 与 web 全链路；完全通过并生成新 handoff 前不得进入 GitHub、Vercel 或 Mainnet。
