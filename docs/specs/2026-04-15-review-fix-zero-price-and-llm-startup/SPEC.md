# Review Fix Spec: Zero Price Listing And LLM Startup

## Goal

修复当前变更里 3 个已确认的回归：

1. Soul listing 必须继续支持 `price = 0`，链上约束要与现有 web sell flow 保持一致。
2. `src/_check-pipeline.ts` 不能再访问不存在的 `collectorState.state` 字段，`npm run typecheck:root` 必须恢复通过。
3. `src/main.ts` 在 `LLM_PROVIDER` 未设置时，必须保持现有 ZAI-only 环境可启动，不能默认要求 Gemini。

## Scope

- `move/soulidity/sources/market.move`
- `move/soulidity/sources/protocol_tests.move`
- `src/_check-pipeline.ts`
- `src/main.ts`
- `src/producer/llm.ts`
- 相关最小回归测试

## Non-Goals

- 不改 web sell flow 现有 `0` 价格交互。
- 不重做整套 LLM 接入，只修正 provider 解析与默认行为。
- 不扩展 `_check-pipeline.ts` 的输出范围，只修到类型正确。

## Constraints

- `price = 0` 视为 Soul listing 合法输入；collection listing 仍保持必须大于 0。
- 启动默认值优先兼容历史环境；显式设置 `LLM_PROVIDER` 时仍按指定 provider 校验。
- 保持最小充分改动，不改无关权限或调度逻辑。

## Acceptance

1. Move 层 Soul listing 不再因 `price = 0` 触发 `EInvalidPrice`，并有回归测试锁定该行为。
2. `npm run typecheck:root` 不再因 `src/_check-pipeline.ts` 报 `TS2339`。
3. `LLM_PROVIDER` 未设置且仅有 `ZAI_API_KEY` 时，启动配置解析会选择 ZAI；显式 `LLM_PROVIDER=gemini` 且缺 `GEMINI_API_KEY` 时仍会报错。
4. 相关 targeted test 与 root typecheck 有新鲜通过证据。
