# Meeting minutes: `animacraft_v7_move`

## 任务与范围

实现 Animacraft v7 Move 核心：把初始穿搭绑定到已认证 Complete Recipe，并覆盖外部 Style 供应、Base/Pack 权限、Recipe 行序与具体 Style 匹配、暂停后安全取回、停产资产继续使用和防重放。明确不改前端、不提交、不部署、不写主网。

## 最终结论

- 线程以 `turn_aborted` 结束，没有形成正式最终交付。
- 唯一明确完成的验证是“认证初始装扮”定向测试 `27/27` 通过。
- 随后进入第二轮协议审计；最后一条消息又把“修到可编译”、外部 Item 供应、Base/Pack 权限、完整 Recipe 授权、防重放、全量 Move 测试和 ABI 文档列为待办。
- 因此不能宣称最终编译或全量测试通过，也不能宣称发布、提交或部署完成。

## 关键决策

- 链上最小持有和穿戴单位是确定外观的 `Style Asset`；`Item Family` 只做商品归类。
- 初始 Style 必须来自已认证 Recipe，不能信任前端自由传入的列表或顺序。
- 付费 Pack 不得伪装成 Included；暂停不得锁死资产，停产不得废除玩家已持有资产的使用权。
- Wardrobe 是 Soul 的系统 companion，不是普通视觉 Part；外部资产按钱包 → Deposit → Wardrobe → Equip 流转。
- v7 是对 v6 的附加扩展，发布开关在完整验证前保持关闭。

## 历史改动与证据路径

脱敏导出不含工具参数、输出或 Git diff，无法恢复本线程精确 changed-file 清单。它只证明阶段性 Recipe 绑定实现及 27 项定向测试。

后续 Git 证据不属于本线程直接成果：`43dfff0` 新增 Physical Soul wardrobe v7，`eacfde1` 合并 PR #27，并固定后续 Animacraft revision。主要恢复路径：

- `move/soulidity/Move.toml`
- `move/soulidity/sources/animacraft_wardrobe_adapter_v7.move`
- `packages/soulidity-sdk/src/physical-wardrobe-v7.ts`
- `packages/soulidity-sdk/src/tx/physical-wardrobe-v7.ts`
- `tests/new-web/physical-wardrobe-v7.test.ts`
- [旧恢复摘要](../recovered-subagent-summaries/animacraft_v7_move-019fc1fb.md)

## 验证结果

- 认证初始装扮定向测试：`27/27` 通过。
- 第二轮协议审计：已开始，无完成结论。
- 最终编译、全量 Move 测试、ABI 文档：无完成证据。
- commit、PR、部署和主网写入：本线程均未执行或未报告。

## 风险、未完成项与后续变化

- 付费 Pack/Included 混淆、Recipe 重排、Style 替换、暂停恢复、停产兼容和防重放在中断时仍缺最终证据。
- 后续 Git 已出现更完整的 v7 集成，但不能反向证明本线程当时完成。
- 当前恢复必须先与后续固定的 Animacraft revision 和 Soulidity v7 提交对账，避免重做或复活过时设计。

## 恢复入口

1. 以 `43dfff0` / `eacfde1` 和后续固定的 Animacraft revision 为基线，对账 Recipe 与初始 Style 的逐行授权。
2. 重跑付费 Pack/Included 隔离、外部供应、Base/Pack 权限、暂停取回、停产兼容和防重放测试。
3. 完整执行 Move 编译与测试并重新生成 ABI；结果未闭环前保持 gate 关闭。

## 来源追踪

- Thread ID：`019fc1fb-dfbc-7613-af37-8b19afef267e`
- Parent Thread ID：`019f5069-93af-7eb1-9308-6f7b7ddcaab0`
- 原始 source：2,718,845,316 B；SHA-256 `555a6afefa33589af0bd77d803ca7877ad2c75085a0c97fb8d763f776d8a5233`
- 压缩正文：1,825,035,925 B；SHA-256 `7b4330ccaf20226e0dd252267b91e69dcaa1aaabea8f8508c4a2d2a450b54f20`
- 脱敏导出：954,608 B，1,228 条消息；SHA-256 `ba00393e4f3d0f0dbb46b410c7b87e1e50d360318315fabc8573c8047a0d1ffe`
- 提取统计：解析 28,585 条记录，0 条无效，排除 115 条超大记录；脱敏文本 712,397 B。
- 提取验证：manifest sidecar、archive/source SHA-256 和大小通过，前后均未检测到打开句柄。
- 代表性消息：
  - `fad73a5edb92cf352ed2ef62d49792ac9d7a53afe683ca7db5a2bfe4642667b5` — `2026-08-02T11:54:59.878Z`
  - `cf07e3a282ee34ec57e3ab5f0ef0cc0667cb060ec7b60dca8fe09ce2fe529c09` — `2026-08-02T11:56:21.350Z`
  - `d468552bf1f90c06e7766c8e2e56e497ab67ff1644b9ddfe1823b57da82d70ab` — `2026-08-02T12:42:37.633Z`
