# Meeting minutes: `pack_recovery_store`

## 任务与范围

历史名称虽为 recovery store，恢复内容实际记录 Soulidity v5 主网发布 dry-run 的依赖/ABI 故障定位与验证。全程无签名、无链上写入。

## 最终结论

- 初次 dry-run 在签名前以 `VMVerificationOrDeserializationError` 失败；根因不是余额、网络或 gRPC，而是 Soulidity 编译所需 `commerce_v5` 与实际引用的旧 Animacraft callable package 不匹配。
- 源码 revision 指向包含 Commerce v5 的版本，但 `Published.toml` 仍指向更早的不兼容地址，形成“源码正确、可调用包过期”的双重固定错误。
- 保持 11 个 Soulidity 模块字节不变、只改为经审核且含 `commerce_v5` 的 callable package 后，dry-run 明确返回退出码 0、`status: success`、30 个对象变化和 13 个事件。

## 关键决策与验证

- 发布和升级脚本必须共同执行依赖/ABI fail-closed 检查，不能靠人工临时改交易。
- 模拟只读取密钥确定 sender/gas，并在签名前返回；没有产生链上交易。
- 历史报告称 1,319 项测试通过；完整命令最后因本机缺少桌面工作区依赖而中断，不应误写为全套最终完成。

## 风险与恢复入口

- 历史包地址以脱敏省略形式出现，不能作为今天的发布配置；当前发布必须重新做 source/callable/TypeOrigin 和链上 ABI 读回。
- 不得将成功 dry-run表述为正式发布。详细事件链见[脱敏恢复摘要](../recovered-subagent-summaries/pack_recovery_store-019feae8.md)。

## 来源追踪

- Thread：`019feae8-8c73-7143-aee6-160f369c5e51`；Parent：`019f5069-93af-7eb1-9308-6f7b7ddcaab0`
- 原始大小：2,358,482,981 B；尾部检查 63.0 MiB；恢复消息 8；终态信号 `unknown`
- 代表消息 SHA-256：`6d0bd2dff610b3aa3fd20d08e25396a6201447c3248697646e129f9d3d766bce`
