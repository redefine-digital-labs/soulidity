# Review Regression Fixes Spec

## Goal

修复本轮 review 指出的 3 个用户可见回归，恢复桌面设备码轮询的确认态幂等性、create/import 流程在 auth 异步完成时的草稿与 hydration 正确性，以及 `.xlsx` 读取对包含制表符/换行单元格的结构化序列化能力。

## Scope

- `web/lib/desktop/device-session.ts`
- `web/components/providers/create-soul-provider.tsx`
- `web/components/providers/import-soul-provider.tsx`
- `desktop/packages/backend/src/agent/skills/file/scripts/read_file.ts`
- 相关自动化测试

## Non-Goals

- 不改动桌面设备绑定协议的对外接口
- 不改动 create/import 流程的步骤设计或持久化 key
- 不新增 `.xls` 支持范围之外的文件解析能力

## Constraints

- 桌面端重复轮询同一 `deviceCode` 时，已确认会话必须保持幂等，不因前一次响应丢失而要求用户重走链路。
- create/import provider 在 `AuthProvider` 从 `loading=true` 过渡到已解析用户时，不能因为 provider remount 丢掉已填写的草稿状态。
- create/import provider 在 auth 最终解析为匿名态时，也必须完成 hydration，让 success 页守卫能够立即重定向而不是一直返回空白。
- `.xlsx` 提取必须对包含 tab/newline 的单元格内容做安全序列化，不能把单个单元格拆成额外列或额外行。

## Acceptance

1. `pollDesktopDeviceSession()` 在确认态下重复调用同一 `deviceCode` 时，持续返回 `confirmed`，且重试返回的 `desktopAccessToken` 不会因重发/乱序响应而自我失效。
2. `CreateSoulProvider` 与 `ImportSoulProvider` 在 auth 从加载态解析到已登录时，不会因 provider remount 丢掉已填写的草稿状态。
3. `CreateSoulProvider` 与 `ImportSoulProvider` 在 auth 最终解析为匿名态时，会将 `isHydrated` 置为 `true`，从而允许 success 页立即按既有守卫重定向。
4. `read_file.ts` 读取包含 tab/newline 单元格的 `.xlsx` 文件时，输出会保留单元格边界，不会把单元格内容错误拆成额外列/行。
5. 新增或更新的自动化测试能覆盖以上 3 类回归。
