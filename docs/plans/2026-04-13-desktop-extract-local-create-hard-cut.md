# Desktop Extract Local Create Hard-Cut

## Goal

把 desktop 的 Extract 流程从“分析后打开 web `/create`”改为“desktop 内本地创建并 mint”，并把 desktop 登录与用户 Sui 钱包签名接入 create/mint 全链路。

## Scope

- `desktop/apps/desktop/src/renderer/components/MainWindow/ExtractTab.tsx`
  用本地向导替代 browser handoff；未登录时在点击 `Start Scan` 前拦截。
- `desktop/apps/desktop/src/renderer/**/*`
  新增本地草稿模型、自动生成的 `cover / soul.md / memory.md`、草稿持久化、desktop 专用 Privy/Sui provider 与 mint UI。
- `desktop/apps/desktop/src/main/**/*`
  暴露 desktop create draft IPC、desktop token -> Privy custom auth JWT IPC。
- `desktop/packages/shared/src/**/*`
  补充 extract draft / create auth 的共享类型与纯函数。
- `web/app/api/desktop/auth/privy-token/route.ts`
  新增 desktop token 可换取短时 Privy custom auth JWT 的服务端入口。
- `web/app/api/souls/{upload,personal-kiosk,publish}/route.ts`
  允许 desktop create auth 访问，同时继续校验链上 sender 必须匹配绑定的钱包。
- `web/lib/desktop/**/*`, `web/lib/soulidity/server.ts`, `web/lib/types/desktop.ts`
  增强 desktop 身份与钱包地址解析，给 desktop renderer 提供 `primarySuiAddress`。
- `web/components/providers/create-soul-provider.tsx` 及相关旧 helper / tests
  清理 `soulProfile` query hydrate 和 desktop browser handoff 相关残留。

## Acceptance

1. desktop 未登录时可以进入 Extract tab，但点击 `Start Scan` 会被拦截，并展示去 `Settings` 完成绑定的引导。
2. desktop 已登录时，Extract 分析结果会直接进入本地 create 向导，不再调用 `shell.openExternal`，也不再依赖 `/create?soulProfile=...`。
3. 本地草稿会保留完整 `SoulProfile` 信息，并自动生成可编辑的默认封面、`soul.md`、`memory.md`；用户手动编辑 markdown 后不会被结构化字段静默覆盖，只能通过显式 regenerate 重建。
4. desktop 重启后可以恢复当前 create draft；清空 draft 后不会残留旧状态。
5. desktop create/mint 只能使用已绑定的人类 Sui 钱包；钱包未连接、无绑定地址、或当前签名地址与绑定地址不一致时必须阻断。
6. `/api/souls/upload`、`/api/souls/personal-kiosk`、`/api/souls/publish` 可接受 desktop create auth，但链上 sender 校验与已有 human wallet 约束不放松。
7. `DesktopMeResponse` 暴露 `primarySuiAddress`，desktop renderer 可据此做 wallet mismatch 校验与 UI 提示。
8. 相关回归测试先红后绿，并覆盖 auth gate、本地草稿生成/恢复、desktop create auth 路由、旧 browser handoff 清理。
