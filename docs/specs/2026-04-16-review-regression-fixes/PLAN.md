# Review Regression Fixes Plan

1. 先锁定回归。
   - 给桌面设备轮询补上“确认态可重试”的失败测试。
   - 给 create/import provider 补上“auth 解析后不 remount 丢草稿、匿名态也会 hydration”的失败测试。
   - 给 `.xlsx` 读取补上“tab/newline 单元格不会被拆列拆行”的失败测试。
2. 再做最小修复。
   - 调整桌面设备确认态轮询逻辑，保证重复 poll 对同一设备会话保持幂等。
   - 移除 create/import provider 对 auth 用户 id 的 remount 依赖，改为显式 hydration。
   - 让 `.xlsx` 读取输出对单元格内 tab/newline 保持安全边界。
3. 最后按 Spec 验收。
   - 跑本轮新增/更新的定向测试。
   - 补充必要的搜索或类型检查，确认没有留下旧逻辑残留。
