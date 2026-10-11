# Meeting minutes: `v6_sdk_web`

## 任务与范围

修复 SDK/Web 的 v6 二级市场路由与回归，不触碰 Move 或部署脚本；随后只读验收主网记录、链上状态、测试覆盖和发布门禁。

## 最终结论

- 普通 Soul、Animacraft v4/v5 和 Collection 二级交易统一路由到 `MarketConfigV6`；首次铸造继续使用 V2。
- 新增 v6 专用 list/buy/cancel builders 与补充事件解析；Web 用 dynamic key `3` 检测 v6 appearance。
- v6 cancel 不依赖 MarketConfig，gate 关闭仍可取回；v6 改价在签名前 fail closed，要求取消后重挂。
- 修复 delist 补充事件误用 TypeOrigin；通用取消事件仍使用 original package。
- 当时缺少可信 `animacraftV6SecondaryContext` 与 Agent v6 composer，因此相关 list/buy 按设计安全拒绝。

## 关键决策

- 缺少可信 v6 context 时不得回退旧 ABI；取消保持可恢复，改价拒绝旁路。
- 本任务后段只读审计没有继续编辑、提交或部署。
- SDK/Web 改动后续随 `bee4a94` 合入 `29c2de5`；`e18a942` / `1ae48c3` 写入 v6 callable、V2/V6 配置、AdminCap 与交易记录，补强了部分记录一致性缺口。

## 历史改动与证据路径

- `packages/soulidity-sdk/src/env.ts`
- `packages/soulidity-sdk/src/events.ts`
- `packages/soulidity-sdk/src/queries.ts`
- `packages/soulidity-sdk/src/tx/animacraft.ts`
- `packages/soulidity-sdk/src/tx/delist.ts`
- `packages/soulidity-sdk/src/tx/list.ts`
- `packages/soulidity-sdk/src/tx/buy.ts`
- `packages/soulidity-sdk/src/tx/update-price.ts`
- `web/lib/hooks/use-list-soul.ts`
- `web/lib/hooks/use-purchase.ts`
- `web/app/api/souls/[id]/delist/route.ts`
- `tests/new-web/sdk-animacraft-builders.test.ts`
- `tests/new-web/sell-flow-regression.test.ts`
- `tests/new-web/soulidity-deployment.test.ts`

## 验证结果

- 初轮：SDK/Web typecheck、builder 37/37、sell/delist 10/10、diff-check 通过。
- 四组回归修复 43/43；聚焦验收 10 文件 172/172。
- 最终全量 212 文件、1350/1350；Root/Web/SDK 类型检查、Web lint、v6 计划校验和 diff-check 通过。
- 链上只读预检确认升级包、V2/V6 配置与 Cap、旧市场状态及跨对象引用一致，三个 gate 关闭。

## 风险、未完成项与后续变化

- 当时仍缺可信 v6 secondary context 注入和 Agent composer；离线 CI 尚未完整锁定跨文件记录、两组 AdminCap 和两笔 digest。
- 本次只读验收未执行 Production Web build、Move build/test。
- 恢复时从 canonical deployment manifest 注入并验证 context，接入 Agent composer，补跨文件一致性、Production build、Move build/test 和最终 CI；缺少上下文继续 fail closed。

## 来源追踪

- Thread ID：`019fc0eb-473d-7582-9502-5ef1912e707a`
- 原始 source：2,505,246,526 B；SHA-256 `300dec1bd6ead596136a3545317c4a2a28d3df00c3c8d4e108a0871ebafc61b0`
- 压缩正文：1,679,062,729 B；SHA-256 `59fe7754b0215c80dd0d127c372eaf18477f92a193fabd4f12a298e79405dbac`
- 脱敏导出：1,169 条消息；SHA-256 `1c508ef825e2d6946a58eedc92000877fe7eb71dc6a0ee984944f5933344fbb9`
- 代表性消息：
  - `c15eb14ac09056580aba51bd3b983ce089d888ed0a8be4a7247a695fb9e704c5` — `2026-08-02T06:00:29.978Z`
  - `ca583e1b040fcaac35f0c37ec2156d6305e70ee30f51b0e8ad1c7b9c9e196169` — `2026-08-02T06:15:08.852Z`
  - `c6ad1f754adb02bbc27b1cd17736d834b150fa33aae47623ffbf21fe6a04c30f` — `2026-08-02T06:48:51.315Z`
  - `256a869048311435f905afa70bb66946a0a9a77026214b76a5464ceb96da6493` — `2026-08-02T06:49:55.008Z`
  - `337a8d8d2baaf1a673754816551559cabbc1ebb51d74bea040a49dba710eb8ba` — `2026-08-02T06:54:29.849Z`
