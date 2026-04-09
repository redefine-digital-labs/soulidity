# Soulidity Tauri 桌面端接入计划

## Summary

- 采用“新建 Tauri 桌面端 + 继续复用 `new-web` 作为统一 API/BFF + 继续复用现有 `SoulAsset` 作为 Soul 形象真相源”的方案，不新建独立 sprites 后端，也不把现有 Next 应用直接包进 Tauri。
- 借用 `docs/plans/2026-04-09-confirmo-sprites-research-and-rebuild-plan.md` 里最有价值的 4 个结构：公开目录、资源 CDN、浏览器登录 + 设备绑定、自定义协议回跳；首期不复制 Arena、上传社区、后台统计等重功能，只为后续预留骨架。
- 首期验收目标收敛为：匿名可浏览“Starter 免费形象 + 运营精选 Soul”目录；桌面端可下载到本地、切换当前主形象、重启后保持；登录后通过设备绑定挂到现有账号体系。

## Implementation Changes

### 1. 新建桌面端工程

- 在 `desktop/` 新建 Tauri 子项目。
- 前端使用 React + Vite，桌面路由首期落 `home / explore / search / persona/:id / library / settings / auth`。
- `explore / search / persona detail` 面向公开目录；`library / settings / auth` 面向本地安装和账号状态。
- Tauri Rust 命令层只负责下载、校验、落盘、切换当前形象、自定义协议和系统集成，不承载业务判断。

### 2. 桌面端本地资源与状态

- 本地持久化拆成两层：
- SQLite 记录 `installed_personas / active_persona / catalog_cache / auth_session / download_jobs`。
- 文件系统保存已下载资源包和解压后的运行时素材。
- “替换形象”只作用于桌面客户端自己的主形象槽位，不碰第三方应用文件，也不做外部资源替换。
- 资源清单统一走 manifest，首期即按可扩展结构定义，避免后续从静态图再重构到多资源包。

### 3. 复用 `new-web` 作为桌面端 BFF

- 在 `new-web/app/api` 下新增 `desktop` 命名空间，而不是单独起新服务。
- 新增目录接口、设备绑定接口、桌面 profile 接口和当前主形象同步接口。
- 设备绑定确认页继续放在 `new-web`，直接复用现有 Privy/Web 登录体系。
- 自定义协议固定为 `soulidity://auth/device`，桌面端通过深链接收绑定结果。

### 4. 目录层与 Starter 免费形象

- 首期免费形象采用“服务端托管 Starter 库”，不内置到安装包。
- 公开目录采用“Starter + 运营精选 Soul”双来源，而不是把所有公开 Soul 自动暴露给桌面端。
- Starter 和 Soul 在目录层统一抽象成 `DesktopCatalogEntry`，前端不区分来源，只区分 `sourceType`。
- 安装包可保留 1 个极简占位形象作为离线兜底，但它不算正式内容源，也不进入公开目录。

### 5. 数据模型扩展

- 继续复用现有 `prisma/schema.prisma` 里的 `SoulAsset`、`SoulCollectionAsset`、`Member`、认证与钱包绑定体系。
- 新增 4 类表即可：
- `StarterPersonaAsset`：服务端托管的免费形象元数据、版本、资源地址、可见性。
- `DesktopCatalogEntry`：统一编排 `starter` 与 `soul` 目录项，负责排序、精选、搜索字段、运营标签。
- `DesktopDeviceSession`：浏览器登录 + 设备绑定的短期会话，负责轮询和深链完成态。
- `DesktopProfile`：账号级桌面资料，只存当前主形象、最近同步时间、桌面偏好；不存本地安装细节。

### 6. 资产真相源与内容边界

- 首期不改 `move/soulidity` 合约，不新增链上 sprite 对象。
- Soul 形象继续以现有 `SoulAsset` projection 为服务端真相源。
- Starter 免费形象完全走服务端资源托管和 CDN 分发。
- 桌面端只消费目录层和 manifest，不直接消费底层链上结构。

## Public APIs And Types

### API

- `GET /api/desktop/catalog`
  - 分页返回 `starter + soul` 混合目录。
- `GET /api/desktop/catalog/:id`
  - 返回单个目录项详情和下载 manifest。
- `POST /api/desktop/device/start`
  - 桌面端申请 `device_code / user_code / expires_at / poll_interval`。
- `POST /api/desktop/device/poll`
  - 桌面端轮询绑定状态并换取会话。
- `POST /api/desktop/device/complete`
  - 网页登录后确认绑定当前账号。
- `GET /api/desktop/me`
  - 返回当前账号桌面资料与当前主形象。
- `PUT /api/desktop/me/active-persona`
  - 同步账号级当前主形象，不管理本地安装细节。

### Shared Types

- `DesktopCatalogItem`
- `DesktopPersonaManifest`
- `DesktopDeviceStartResponse`
- `DesktopDevicePollResponse`
- `DesktopProfile`

### Manifest 最小字段

- `id`
- `sourceType`
- `sourceRef`
- `title`
- `coverImage`
- `thumbnail`
- `version`
- `files[]`
- `checksum`
- `updatedAt`

## Test Plan

### 数据与 API

- migration + seed 后，匿名目录必须同时返回 Starter 资产和精选 Soul，隐藏项不得泄漏。
- Soul 目录项下线后，桌面端旧安装不被强删，但新目录请求不再返回该项。
- 设备绑定流程覆盖：
- 未登录
- 已登录未确认
- 已确认
- 过期
- 重复轮询
- 非法 code

### 桌面端

- 下载 Starter 资产成功并写入本地目录，校验失败时回滚临时文件。
- 下载 Soul 资产成功，切换为当前主形象后 UI 即时更新，重启后仍保持。
- 目录缓存失效时可回源刷新；离线时仍能展示本地已安装形象和最近一次主形象。

### 端到端

- 匿名进入桌面端浏览公开目录，下载 Starter 形象并设为主形象。
- 已登录用户从桌面端发起设备绑定，浏览器完成登录确认，桌面端拿到会话并同步当前主形象。
- 至少覆盖 1 条 `starter` 和 1 条 `soul` 资产的全链路 smoke test。

### 平台策略

- 首轮验收以 macOS 可运行 smoke test 为准。
- Windows 先保证 Tauri 构建和核心测试通过，第二轮再补真实安装和路径 QA。

## Assumptions And Defaults

- `docs/plans/2026-04-09-confirmo-sprites-research-and-rebuild-plan.md` 本轮只吸收“公开目录、资源分发、设备绑定、桌面协议”这些结构，不复制 Arena、评论、后台、Avatar Studio。
- 首期公开目录采用“Starter + 运营精选 Soul”，而不是“所有公开 Soul 自动入库”；等桌面入口跑通后，再决定是否开放创作者自助入库或从 Soul 发布链路直接暴露。
- 首期不做第三方应用资源替换、不做桌面内上传/发布、不做评论/点赞/关注；这些留到后续阶段，避免把 MVP 从“可下载并替换桌面主形象”拉成第二套社区产品。
- 首期 Tauri 桌面端按跨平台骨架设计，但验收先以 macOS 为主。
- 首期登录路径固定为“浏览器登录 + 设备绑定”，不做桌面内嵌登录。
