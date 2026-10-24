# Lessons

## 2026-10-24 — 后台调用 codex exec 必须关闭 stdin

- **现象**：`codex exec "<prompt>" > out.log 2> err.log` 在后台运行 30 分钟无任何输出，stderr 仅有 `Reading additional input from stdin...`。
- **根因**：`codex exec` 在 stdin 非 TTY 且未关闭时会等待 stdin EOF，把输入附加为 `<stdin>` 块；后台 shell 的管道保持打开，读取永不返回。
- **规则**：后台启动 codex 一律加 `< /dev/null`；启动后 30 秒内做一次确认（stdout 应出现会话头，stderr 不应出现 stdin 提示），不要等到超时才发现。
- **通用化**：任何可能读 stdin 的 CLI（codex、gh、npm init、交互式安装器）在后台/非交互运行时都应显式 `< /dev/null` 或传 `--yes` 类参数。
