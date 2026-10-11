# Meeting minutes: `v6_final_audit`

## 任务与范围

只读复核 Soulidity v6 升级、旧市场退役、链上对象、部署记录、生产路由和 Animacraft TypeOrigin 配置，并区分“关闭态可安全升级”与“可以正式激活”。本任务不修改、不部署、不签名、不发交易。

## 最终结论

- 审计时关闭态可安全升级/部署，但不能据此开放全部能力。
- 所有关联 gate 为 `false` 时，升级、退役、ABI/布局兼容、journal/reconcile、购买原子同步和部署门控无剩余 P0/P1。
- v6 Secondary 当时仍有 P1 激活阻断：缺少可信 secondary context 注入和 Agent v6 交易路径。
- 审计快照：Legacy paused；V2 primary/secondary 关闭；V6 secondary 关闭；Legacy AdminCap 已删除；V2 AdminCap 包入 V6 AdminCap；journal 为 null。
- v6 owner-proof 当时未绑定；TypeOrigin 可登记，但 proof 字符串必须为空，Composition gate 必须关闭。

## 关键决策

- 对外 callable 统一使用 v6 callable；升级 family 的永久原始命名空间/旧类型来源保持独立。
- v5 binding TypeOrigin 与 v6 owner-proof TypeOrigin 必须拆开，不能混淆 callable、Seal namespace 与 TypeOrigin。
- Animacraft 配置来自 `public/config.js`，不消费 Soulidity 的 MarketConfigV2/V6 object ID。
- proof 绑定只完成 Mainnet dry-run；实际绑定并读回前不得填写 proof type 或开 gate。

## 历史改动与证据路径

- `move/soulidity/Published.toml`
- `packages/soulidity-sdk/src/deployment-manifest.json`
- Animacraft `public/config.js`、`runtime-config.js`、`deployments/mainnet.json`
- Animacraft `test/deployment-record.test.js`、`test/runtime-config.test.js`、`test/mainnet-preflight-v6.test.js`
- 后续主网记录 `e18a942f1b12c70801f4ac7d89a024a786f0d27e`；PR #26 merge `1ae48c3c9853ff35d8da3f15a57d55a7c696244e`

## 验证结果

- ABI/public struct/function 兼容审计通过，`git diff --check` 通过。
- deployment manifest、Published.toml、链上对象和升级/退役摘要一致。
- 三层市场 gate、AdminCap 所有权和 journal 读回通过。
- 未来 proof 绑定 Mainnet dry-run 成功，但没有实际执行。
- `npm run check`、主网 preflight 和 production smoke 在原记录中是建议后续命令，不能记为本任务已执行。

## 风险、未完成项与后续变化

- 当时 Production 曾仍指旧 callable 且缺公开 V2/V6 路由；因 gate 为 false 而 fail closed，但不等于完整上线。
- v6 proof 未绑定，secondary context/Agent 路径未闭环；UpgradeCap、歧义 journal 和远端旧环境值是保留风险。
- 同日稍后出现 PR/生产同步乃至激活叙述，但脱敏素材没有完整最终激活交易与读回，因此本纪要中的 gate 值只代表审计时快照，不能证明当前状态。
- 恢复时必须从当前部署清单和链上重新读回，禁止直接沿用本纪要旧值。

## 来源追踪

- Thread ID：`019fc0f7-a4b3-7970-9c54-38980fe575a0`
- 原始 source：2,577,211,901 B；SHA-256 `e19a9c7d748e9ee074fa7f8bd5291b722ce051c8c62415be31922f5c045c746d`
- 压缩正文：1,728,055,036 B；SHA-256 `c088b675137f3b88faacd90193836aba9be37840f3b29489870e1d378078355d`
- 脱敏导出：1,173 条消息；SHA-256 `fb8f327ddae6b022063b99eccfe73082e3e27ffed05c55ac4f9cd16f452ec5e3`
- 代表性消息：
  - `87869d5fe6d88e95fd375995375cea81c5a9fce6f541024161ddb01b38abb05d` — `2026-08-02T06:24:53.750Z`
  - `4c6d4087478628bf0595664ac76c0898a17aa72334f991abc17252f5ecc7fad3` — `2026-08-02T06:45:23.429Z`
  - `a50098182c967bbf2f724dd4f31c609d70099db392e6b7c209d31f9197ec43d9` — `2026-08-02T06:58:55.668Z`
  - `86ddf54e43b354cef9ca0a5cb4542bec37e2d75d9c66ffd974259991729cf479` — `2026-08-02T07:38:01.871Z`
  - `023b5aaa3cfa58a7d1959300f4575503866c00922927f0f003515f9b74616acc` — `2026-08-02T07:43:13.637Z`
