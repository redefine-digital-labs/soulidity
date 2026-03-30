# Soul Unft Hard-Cut Spec

## Goal

一次性把 Soul 发布与交易链路从 `unft_standard` / `NftMintCap<Soul>` / `soul_market_adapter` 过渡层切掉，收敛为 `soul_object::market` 直连、公开直铸、单例 personal kiosk 运行时，并同步清理旧配置、旧测试、旧文档、前端 `alert()` 交互，以及 Souls publish 中“用户手动上传加密包”的旧责任边界，不留双轨尾巴。

## Scope

- `move/soul_object/**`
- `move/soul_market_adapter/**`
- `prisma/**`
- `web/lib/souls/**`
- `web/app/api/souls/**`
- `web/app/api/agent/souls/**`
- `web/app/admin/**`
- `web/components/souls/**`
- `tests/web/**`
- `.env.example`
- `SPEC.md`
- `PLAN.md`

## Non-Goals

- 不兼容开发环境里已存在的多 personal kiosk 历史状态
- 不保留 `unft_standard` collection/mint authority 语义
- 不保留 adapter 双轨调用或旧链数据迁移
- 不扩展新的审核/权限模型；发布页继续对所有人开放

## Constraints

- 本轮是硬切，新方案确认替代旧方案后，旧入口、旧 env、旧测试、旧 Move 包、误导性注释都必须一起清掉
- `SoulListed` / `SoulPurchased` 事件字段保持兼容，避免镜像层再次分叉
- `personal kiosk` 运行时语义必须是单例；重复初始化不再生成第二个 kiosk
- 前端不能再调用浏览器 `alert()`；错误反馈改为 modal
- 下载内容时必须保留 Seal sidecar 中的原始 `mimeType`
- Souls publish 必须改成“用户只选择原始内容文件，发布时由系统完成加密上传”；浏览器本地草稿不得在未进入上链恢复阶段时保留内容上传中间态

## Acceptance

1. `move/soul_object::soul` 不再依赖 `NftMintCap<Soul>`、`SoulPackageAuthority`、`Publisher` 转存或 `market_bootstrap`；`mint` / `mint_with_creator_royalty` 直接由模块内部调用。
2. `move/soul_object::market::mint_and_list_fixed_price` 不再接收 `mint_cap` / `collection`，直接 mint 并上架到 creator 的 personal kiosk。
3. `move/soul_object::market` 以 `MarketConfig` 为单例 personal kiosk registry 根对象；第二次 `init_personal_kiosk` 必须失败，`reuse_personal_kiosk` 只接受登记过的 cap。
4. 仓库活动代码中不再存在 `unft_standard` 主链路依赖、`market_bootstrap.move`、`soul_market_adapter` 活动入口、`NEXT_PUBLIC_SOUL_MINT_CAP_ID`、`NEXT_PUBLIC_SOUL_COLLECTION_ID`、`NEXT_PUBLIC_SOUL_MARKET_ADAPTER_PACKAGE_ID`。
5. Web tx builder、purchase quote、publish、purchase、personal kiosk 解析和相关 API 全部直连 `NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID::market::*`；publish 对“首次发布自动建 kiosk”和“已有 kiosk 复用发布”两条路径都已收口。
6. Web personal kiosk 运行时只暴露 `ready | missing`；出现多个 cap 或 registry 不一致时，视为 invariant error，而不是继续返回 `multiple` 兼容状态。
7. `web/components/souls/access-download-button.tsx` 下载时使用解密结果返回的 `mimeType` 创建 blob。
8. 前端活动代码中不再存在 `alert(...)`；原先 alert 交互改为 modal 呈现。
9. Prisma 新增硬切 migration，清理 Soul 旧镜像/准备态数据，确保新 package 切换后由新链重新镜像。
10. `npm run typecheck`、`npm test`、`sui move test --path move/soul_object` 通过；若某项受外部环境阻塞，需明确记录阻塞原因。
11. `web/app/souls/publish/page.tsx` 不再向用户暴露“Upload encrypted content bundle”式的两段式交互；用户只需选择原始内容文件，点击 Publish 后由系统调用上传接口完成加密上传、拿到 `contentBlobObjectId` 后再构建交易。
12. `web/lib/souls/publish-draft.ts` 只在已进入可恢复的上链发布阶段时保留 `contentBlobId` / `contentBlobObjectId` / `sealDekEnvelope` / `metadataRef`；纯本地草稿不得残留这类系统中间态。
