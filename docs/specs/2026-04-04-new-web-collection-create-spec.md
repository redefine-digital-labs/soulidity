## Goal

为 `new-web` 补齐 Collection 创建入口的前端闭环：用户可以从导航进入 `/collections/create`，在受登录保护的单页表单里填写 Collection 参数、发起链上签名、等待镜像同步，并在成功后跳转到新建 Collection 详情页。

## Out Of Scope

- 不在本轮引入多步骤向导、文件上传或图片托管。
- 不在本轮扩展 Collection 编辑、删除、再次上架或分享能力。
- 不处理当前仓库与本任务无关的全局类型错误，只记录其对验收的影响。

## Constraints

- 必须复用现有 `AuthGate`、`PageContainer`、`SectionHeader`、`Input`/`Textarea`、`buttonStyles` 与 `useCollectionActions`，不引入新依赖。
- 不能只修 UI，不修链路契约。`createCollection()` 的 API 目标、返回字段消费和成功跳转必须同轮收口。
- 前端表单校验要与链上 builder 使用的 Collection 参数校验保持一致，特别是 UTF-8 byte 限制和 `extraRoyaltyBps` 上限。
- 新入口确认替代旧的错误入口后，要同步清理桌面导航和移动导航中的旧链接残留。

## Acceptance

1. 桌面和移动导航都提供 `Create Collection` 入口，并统一指向 `/collections/create`。
2. `/collections/create` 受 `AuthGate` 保护；匿名访问时显示登录提示而不是空白页或 404。
3. 创建页是单页表单，至少包含 `name`、`description`、`imageUrl`、`extraRoyaltyBps`、`tradeable` 五个参数，并在提交前做必填与 byte/BPS 边界校验。
4. `useCollectionActions().createCollection()` 不再 POST 到 `/api/collections`，而是命中 `/api/collections/create`。
5. 创建流程对 UI 暴露可区分的阶段状态，至少能区分 `signing`、`syncing`、`error`，不再只有模糊的 `pending='create'`。
6. 创建成功后前端使用接口真实返回的 `collectionOnChainId` 跳转到 `/collections/{collectionOnChainId}`。
7. 针对本轮新增的校验和导航入口，仓库内有最小回归测试或源码级回归守卫。
8. 验证至少覆盖：相关 Vitest 用例通过，以及 `new-web` 改动面的类型检查可运行；若全量 `next build` 仍被仓库既有错误阻塞，要明确记录阻塞点。
