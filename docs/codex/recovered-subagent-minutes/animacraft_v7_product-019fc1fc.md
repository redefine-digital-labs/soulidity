# Meeting minutes: `animacraft_v7_product`

## 任务与范围

规划并实现 Animacraft v7 产品侧“Style 是最小实体商品、Soul 拥有真实衣柜”的模型，范围限于 Animacraft 前端/JS 产品模型、Creator/Player 接线、第三方供给包和安全校验；不修改共享 Move 合约、不提交、不部署、不写链。

## 最终结论

- v7 产品层完成并验证，固定层级为 `Part / Slot → ItemFamily → StyleProduct`；玩家持有、交易和穿戴确定 Style，而非抽象 Item 大类。
- Smart Color 排除出可交易资产；关联 Smart Color 的 Style 必须先烘焙为固定 PNG，创建和重新关联均会阻断。
- Creator Studio 和 Player 商品状态接线完成，支持 Included、Open Edition、Limited Edition，以及 Official/Certified/Open 准入语义。
- 第三方创作者可下载模板并提交精确 Style Product 包；导入校验 Walrus Blob、PNG 哈希、权利快照、Maker/Profile/Part、Layer Track 和冲突。
- 发布 gate 保持关闭，未接通的购买/装备链上动作 fail closed；改动未提交，共享 Move 文件未触碰。

## 关键决策

- 视觉“背包”可以是 Part，但 Soul Wardrobe 必须是系统级 companion；Part 首版与 Slot 一对一，Layer Track 只管渲染顺序。
- Maker 内置内容使用 entitlement，避免每次 Mint 批量复制 NFT。
- 外部资产目标语义：钱包 → Deposit → Soul Wardrobe → Equip；Unequip 回衣柜，Withdraw 才回钱包。
- 首版出售 Soul 前必须取回全部外部资产，不做隐式 bundle sale。
- 供应量、价格、版权、版税属于具体 Style Product；第三方 creator 只能向已发布 Maker 的精确 Slot 提交兼容 Style。
- v7 是 v6 商品/验证/entitlement 基础上的 Physical Wardrobe 扩展，不能破坏已部署 v6。

## 历史改动与证据路径

原工具输出被安全排除，因此该 Animacraft 子任务的精确 changed-file 清单未恢复；可确认改动类别为 v7 数据模型/保存兼容层、Creator/Item Studio、Player 状态 UI、第三方模板与导入校验、五语言文案和测试。

后续 Soulidity Git 佐证（不是本子任务直接改动）：`43dfff0ab137405b4062b258f1aa96621f40576e`，merge `eacfde1c32d0a929fa2b6b393af227c458b70b64`，代表路径：

- `move/soulidity/sources/animacraft_wardrobe_adapter_v7.move`
- `packages/soulidity-sdk/src/physical-wardrobe-v7.ts`
- `packages/soulidity-sdk/src/physical-renderer-v7.ts`
- `packages/soulidity-sdk/src/tx/physical-wardrobe-v7.ts`
- `web/components/souls/physical-wardrobe-v7.tsx`
- `tests/new-web/physical-wardrobe-v7.test.ts`

## 验证结果

- 第一阶段 837 tests 通过、0 失败、1 个既有跳过；Production build 通过。
- 加固定向测试 120 项通过。
- 最终全量 841 项：840 通过、1 个既有跳过、0 失败；Production build 与 `git diff --check` 通过。
- 共享 Move 未触碰，没有提交或链上写入。

## 风险、未完成项与后续变化

- 本任务只完成产品层；StyleAsset、真实 custody、Deposit/Equip/Unequip/Withdraw、供应铸造和链上 ABI 当时仍待接。
- 改动未提交，精确文件清单不可从脱敏导出恢复；发布 gate 关闭，不能把购买/装备视为已上线。
- 恢复时先找回独立 Animacraft v7 worktree并保存差异，与 Soulidity `43dfff0`/`eacfde1` 的最终 ABI、SDK 类型和 handoff 逐项对齐，再重跑 841 项检查与生产构建。
- 只有购买、custody、装备/取回、回滚和链上读回闭环后才可开 gate。

## 来源追踪

- Thread ID：`019fc1fc-61c2-7072-9abe-72c7d33184ef`
- 原始 source：2,670,015,911 B；SHA-256 `fa75b3e838899d0fd348850443e99514508c7151cb48a57534960feb142141c9`
- 压缩正文：1,792,229,322 B；SHA-256 `9b84d0b5aa096caf850dccbbfc377804397e17c5794957fc7006503c3ed47581`
- 脱敏导出：1,232 条消息；SHA-256 `7c9ec5cd4c96496a4c43b851abdf13697c85369cf90acaa5b59256bceada2d80`
- 代表性消息：
  - `716c99a0e7e7210cf2a1c0d66f09fbe9304d567dcdd054b7f02ae6c2a17e728b` — `2026-08-02T10:19:38.749Z`
  - `f0ca41c05f405c8e2fd0687ac26a902c4fcecacf2c96df793e2e3b9a9933c2e3` — `2026-08-02T10:19:38.770Z`
  - `5a896059956516e7b91e7f8a8ad48684ceaf13845f820c37c9592b9b5d2edb01` — `2026-08-02T10:47:35.902Z`
  - `49c09d8e7678eba41030e969092b14aa66e12af49319d5a20fc8ac86d195ae0c` — `2026-08-02T10:48:59.679Z`
  - `f4b98e80e18e60f2aeadd866d8511619a8456827495af050fc14675874e632ef` — `2026-08-02T11:05:51.370Z`
