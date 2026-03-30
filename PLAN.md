# Soul Unft Hard-Cut Plan

1. 先对齐规格与测试契约。
   - 更新 `SPEC.md` / `PLAN.md` 为公开直铸、single-kiosk、adapter 删除、`alert -> modal` 的目标。
   - 先改 Web / Move 测试，让测试只认新 package、单例 kiosk 与 MIME/modal 行为。
2. 再改 Move 侧 ABI 和状态模型。
   - 删除 `unft_standard`、`market_bootstrap`、`SoulPackageAuthority` 相关依赖与代码。
   - 在 `soul_object::market` 中把 `MarketConfig` 作为 personal kiosk registry 根对象，把 `init_personal_kiosk` 改成单例约束。
   - 让 `mint_and_list_fixed_price` 直接 mint + list，不再接收 `mint_cap` / `collection`，并补已有 kiosk 的复用发布入口。
3. 再改 Web 运行时与前端交互。
   - `config.ts`、`tx-builder.ts`、`purchase-quote.ts`、publish/purchase/personal-kiosk API 全部切到 `soul_object::market`。
   - personal kiosk 解析只保留 `ready | missing`，把重复 kiosk 视为 invariant error。
   - 修复下载 MIME 传递，并把前端 `alert()` 改成 modal。
   - Souls publish 内容链路收口为“用户只选择原始文件，提交时由系统完成加密上传”；浏览器草稿仅在进入上链恢复阶段后保留内容上传中间态。
4. 最后做清理、迁移和验证。
   - 删除 adapter 活动包和旧 env / repo-contract 断言。
   - 新增 Prisma 硬切 migration 清理 Soul 旧镜像数据。
   - 运行 `npm run typecheck`、`npm test`、`sui move test --path move/soul_object`。
