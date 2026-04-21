# Plan（收口执行）

1. 将 V6 示例代码落库为真实 TS 计划模块，并导出给共享层使用。
2. 新增 `scripts/export-v6-plan-json.ts`，由 TS 计划单向生成机器可读 `v6.plan.json`。
3. 升级 `scripts/validate-v6-plan.mjs` 为语义校验（章节 + JSON + dependsOn + 环依赖 + 文件存在）。
4. 新增 `tests/desktop/desktop-improvement-plan.test.ts` 覆盖计划核心约束。
5. 收敛 AGENTS 的版本融合规则为长期通用表述。
6. 将验证接入根 `package.json` 脚本链路，默认纳入测试前置。
7. 运行脚本与测试并修复问题，完成提交与 PR 记录。
