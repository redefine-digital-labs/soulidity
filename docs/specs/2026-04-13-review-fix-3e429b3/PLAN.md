# Review Fix Plan: 3e429b3

1. 先补失败测试。
   - 为 migration 新增 SQL 断言测试，锁定 canonical keep signal。
   - 为 `TaskCoordinator` 新增 shutdown 行为测试，锁定“停止执行 + 不重复 pushMessages”。
2. 再改实现。
   - 扩展 migration keep rule。
   - 为 coordinator 增加 shutdown/drain 能力，并让 ws shutdown flush 走这条路径。
3. 最后验证。
   - 跑新增 migration test。
   - 跑 desktop backend 相关 test。
   - 必要时补一遍相关 typecheck / targeted test。
