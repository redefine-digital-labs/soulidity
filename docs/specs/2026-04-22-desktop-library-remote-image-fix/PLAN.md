# Plan

1. 固定 root cause：确认 remote thumbnail URL 本身可访问，问题来自 desktop renderer `index.html` 缺少 `img-src`。
2. 只放开 desktop 实际需要的图片来源：`'self' data: blob: file: https:`，不顺手放宽脚本或其他高风险指令。
3. 补一个直接读取 `renderer/index.html` 的 regression test，锁住 `img-src` 和 `script-src` 契约。
4. 跑 targeted test，并重新打包启动 packaged desktop，确认新 bundle 生效。
