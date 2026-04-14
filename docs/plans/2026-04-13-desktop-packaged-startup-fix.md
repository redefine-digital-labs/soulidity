# Desktop Packaged Startup Fix

## Goal

修复打包版 desktop 启动时的首次 persona 模板复制路径错误，避免应用尝试向 `.app/Contents/data` 写入文件并导致服务启动失败。

## Scope

- `desktop/packages/backend/src/paths.ts`
  提供安全的 data 目录初始化 + builtin persona 模板复制入口，避免依赖 fallback 路径探测。
- `desktop/packages/backend/src/*.test.ts`
  覆盖“显式 dataDir 初始化后，模板写入 userData/data/persona”回归测试。
- `desktop/apps/desktop/src/main/index.ts`
  启动时先初始化 dataDir，再复制 builtin persona，再 boot services。

## Acceptance

1. 打包版启动时，内置 persona 模板复制目标是 `app.getPath('userData')/data/persona`，不是 `.app/Contents/data/persona`。
2. 首次启动缺少 `SOUL.md` / `BOOTSTRAP.md` 时，模板可成功落到 data 目录。
3. 相关单测先红后绿，并覆盖显式 dataDir 初始化链路。
