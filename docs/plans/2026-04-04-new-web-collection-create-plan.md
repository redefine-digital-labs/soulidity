1. 先补任务级回归测试。
   - 为创建页表单状态和成功跳转目标新增纯函数测试。
   - 为导航入口、AuthGate 布局和 hook API 目标新增源码级回归守卫。
2. 再收口创建链路契约。
   - 修正 `useCollectionActions().createCollection()` 的 API URL。
   - 给 `useCollectionActions` 增加和现有 buy/list 流程一致的阶段状态输出，保留现有调用方兼容。
3. 实现 `/collections/create` 页面。
   - 新增受 `AuthGate` 保护的 layout。
   - 新增单页表单、字段校验、错误提示、提交态文案和成功跳转。
4. 收口导航与入口。
   - 更新桌面下拉菜单链接。
   - 更新移动端导航，补上 `Create Collection` 入口。
   - 让当前创建页在菜单内有可见 active 状态，而不是保留无效的 `isActive` 变量。
5. 做改动面验证并记录边界。
   - 运行新增/受影响的 Vitest 用例。
   - 运行 `npm run typecheck:new-web`；若被既有问题阻塞，记录具体文件和错误。
