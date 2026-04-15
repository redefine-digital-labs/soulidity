# Review Fix Plan: Zero Price Listing And LLM Startup

1. 先锁定红灯。
   - 把 Move 零价 listing 测试改为“应成功”。
   - 为 LLM provider 解析补最小单测，锁定默认回退到 ZAI。
   - 跑一次 `npm run typecheck:root`，确认 `_check-pipeline.ts` 当前确实报错。
2. 再做实现。
   - 删除 Soul listing 的零价链上拦截。
   - 修正 `_check-pipeline.ts` 的 collector state 输出。
   - 抽出并复用 LLM provider 解析逻辑，让 `main.ts` 兼容未设置 `LLM_PROVIDER` 的 ZAI-only 环境。
3. 最后验证。
   - 跑相关 Move test。
   - 跑 LLM provider 单测。
   - 跑 `npm run typecheck:root`。
