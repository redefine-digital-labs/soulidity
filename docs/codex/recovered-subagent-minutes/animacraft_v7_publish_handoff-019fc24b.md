# Meeting minutes: `animacraft_v7_publish_handoff`

## 任务与范围

收口 Animacraft v7 的 Style 发布、Creator 恢复、Player Complete 和 Soulidity handoff：独立 Walrus manifest、canonical definition/PNG 校验、StyleProduct commitment、规范 Recipe 投影、BCS `authorizationCommitment`、OC 初始装备摘要和既有 Maker 的第三方 Style 增量发布。

## 最终结论

- 线程以 `turn_aborted` 结束，没有正式完成结论，不能记作“发布交接已完成”。
- 截止最后消息仍在收口：既有 Maker 增量发布第三方 Style；把 Player Complete 的可信初始装备摘要接入发布/恢复流程。
- 已确认完整 v5 Recipe 的行序语义和 Move 初始授权 ABI，但没有最终 diff、测试、构建、发布摘要或链上读回。

## 关键决策

- 同一 Item 的多个 Style 共享 Family commitment，但每个 Style 保持独立 canonical definition、PNG locator、StyleProduct 和恢复检查点。
- Style 写链前必须先验证独立 Walrus manifest、内容 hash 和 PNG 定位。
- Complete 按完整 Recipe 行序授权：视觉行绑定 Family/StyleProduct，None/Color 只参与 hash，不能只传无行号的 Style ID。
- Creator 消费已验证的 v6 Profile/Product/admission 输出，不能手填对象 ID。
- 必须等待最终 Move ABI；gate 关闭时应完全不触网，第三方 Style 不得伪装成 Base Item。

## 历史改动与证据路径

线程确认了多 Style Family/Recipe 映射约束、规范投影、Move 行序 ABI 和 Walrus 恢复检查点；但前端 BCS commitment、增量发布和 OC 初始摘要仍是进行时。工具输出被排除，无法恢复 Animacraft 独立仓库的精确 diff。

后续 `43dfff0` / `eacfde1` 增加 v7 handoff schema、完整授权行、SDK 与测试；`832616a`、`40abb29`、`754e7d3` 继续市场和管理。这些不证明中断前发布完成。

主要恢复路径：

- `move/soulidity/Move.toml`
- `move/soulidity/sources/animacraft_wardrobe_adapter_v7.move`
- `packages/soulidity-sdk/src/physical-wardrobe-v7.ts`
- `web/lib/animacraft/handoff.ts`
- `web/lib/hooks/use-animacraft-mint.ts`
- `tests/new-web/physical-wardrobe-v7.test.ts`
- [旧恢复摘要](../recovered-subagent-summaries/animacraft_v7_publish_handoff-019fc24b.md)

## 验证结果

- 已确认 Move 初始授权 ABI 的行序和行类型语义，并识别多 Style 映射问题。
- 未保留测试数量、通过结果、production build、发布交易或链上读回。
- “第三方 Style 不伪装 Base”“顺序不可篡改”“关闭 gate 不触网”在最后仍是待验证目标。

## 风险、未完成项与后续变化

- 最大风险是把中断前的计划或进行中工作误记为已发布。
- Animacraft 是独立仓库；Soulidity 后续提交不能恢复其未提交 diff、Walrus 上传或 Creator 发布状态。
- Family/Recipe 投影、PNG/hash 或 BCS 编码任一不一致，都会使 Complete 授权失败或产生错误初始衣橱。

## 恢复入口

1. 在 Animacraft 独立仓库定位最终 v7 revision 和历史工作区；以 `43dfff0` handoff schema 对账，不假设 Animacraft 侧已经完成。
2. 核对每个 Style 的 Walrus manifest、canonical definition、PNG/hash、Family commitment、Recipe 行序、BCS commitment 和 OC 摘要。
3. 补完增量第三方 Style 发布与 Player Complete 恢复，重跑定向/完整测试、生产构建和发布 dry-run；保存 diff、发布摘要与读回前不得称为完成。

## 来源追踪

- Thread ID：`019fc24b-4db6-7323-932d-cc28ef173b5a`
- Parent Thread ID：`019f5069-93af-7eb1-9308-6f7b7ddcaab0`
- 原始 source：2,811,878,840 B；SHA-256 `c657d9b822b4ae21f02fe8c0b35f06bd3a644585ceeb28cbb8d11ab872198b08`
- 压缩正文：1,889,413,545 B；SHA-256 `6e5a444791e6e7b64e20e3bb8a3860c3026a633530bdc1bcf70ec3a87ae92ae0`
- 脱敏导出：962,548 B，1,243 条消息；SHA-256 `87b860238d6c6a89a74ebc87152e0958c44aea6be5837ec1e1e649eecf941885`
- 提取统计：解析 27,877 条记录，0 条无效，排除 119 条超大记录；脱敏文本 717,529 B。
- 提取验证：manifest sidecar、archive/source SHA-256 和大小通过，前后均未检测到打开句柄。
- 代表性消息：
  - `e05211298582d206be663cf95593040199efd7f601ea4d6be2eabca1b948d9d1` — `2026-08-02T12:00:16.946Z`
  - `1b0c08e1a78c1ffb5b837214ddbce835716f268482fea2a23480a881ed745cd0` — `2026-08-02T12:08:47.961Z`
  - `e1f3423311bb26987f5a134e23fd4de63504c334c39b670485c7ced6a56cb6ed` — `2026-08-02T12:21:11.840Z`
  - `e4777afb23431c5e06ff4280a585b3e1107828d1ac01e0b4e04d5d3409deb064` — `2026-08-02T12:45:47.444Z`
  - `68a1b8ad22881f88637c19fc8696cdde63e2f73985bc8c1facd92abf1c25a438` — `2026-08-02T13:17:27.977Z`
  - `31db001d56a424d19f66a1ac34c92e696d4fc496d165da0eadb019688466e965` — `2026-08-02T13:49:27.017Z`
