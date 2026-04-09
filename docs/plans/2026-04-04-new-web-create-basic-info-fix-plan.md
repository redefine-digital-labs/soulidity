1. 先补结构回归守卫。
   - 为 `/create` 页面锁定截图对应的字段集合和 CTA 文案。
   - 锁定 `Preview Image` 必须继续复用 `UploadZone` 并保留本地预览状态。
   - 锁定 royalty 只保留 4 档，并且 `Standard` 带推荐态。
2. 再重写 `/create` 页面 Step 1。
   - 移除 `FlowBar`、`Starting Price`、`List immediately` 等与截图冲突的旧结构。
   - 新增 `Category`、`Tags`、`Preview Image`、锁定提示卡和底部操作区。
   - 调整输入框、上传区、royalty 卡片和按钮布局，使视觉与参考图接近。
3. 如有必要，补齐 `UploadZone` 的可定制能力。
   - 只做当前页面需要的最小扩展，避免影响其他上传场景。
4. 最后验证。
   - 运行 `npm test -- tests/new-web/create-basic-info-ui.test.ts`。
   - 运行 `npm run typecheck:new-web`；若被既有问题阻塞，记录阻塞点。
