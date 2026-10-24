# TypeScript ABI 同步：规格、计划与验证

范围：审计记录 §11.1 的 fresh-release ABI 同步，仅修改 SDK、web、desktop 的 TypeScript、相关测试与配置文档。保留已有 Move 工作，不修改 `move/`，不提交或推送。

验收：
- 所有已存在的 gated 调用使用普通 shared-object gate；Seal 的 document ID 为首参，gate 为第二参，其余 gated 函数以 gate 为首参。
- deployment/env、浏览器与 desktop 的运行上下文传递 `protocolGateId`；未部署配置为空，缺失时明确失败。
- 钱包 collection 绑定使用 V2 market wrapper；预检拒绝 Animacraft native provenance 及超出 10000 bps 的费率组合。
- 错误翻译覆盖新 abort codes；用户文档说明 listing 期间内容写入冻结。
- 先扩展 Vitest 并记录 RED，再实现；最终 `npm test`、`npm run typecheck`、SDK 独立 `tsc` 全通过。

执行与核验：
1. SDK 构建器、Seal 调用链、collection/错误映射由互不重叠的执行者同步；主执行者处理部署接线与集成。
2. 先执行各范围定向测试，修复现有测试 fixture 与调用方的 ABI 影响，保留断言强度。
3. 汇总全量测试和类型检查，核查无漏掉的旧调用及越界写入。Claude reviewer 后续独立接受或拒绝。

回滚：本轮未部署且未提交；按交付文件清单逆向撤回本轮 TypeScript diff，保留任务开始前已存在的 Move、审计与 tasks 改动。不要对整个 worktree 执行 reset/clean。

## TDD 证据

各范围先运行以下测试观察失败，再修改对应实现；既有快照、u64 精度、签名、历史对象与错误断言均保留。

| 测试范围 | RED 证据 | 定向 GREEN |
| --- | --- | --- |
| `sdk-protocol-gate-builders` | 23 failed / 1 passed | 新增 24/24，SDK 相关 8 files / 240 passed |
| collection wrapper + abort mappings | 17 failed / 128 passed | 联合范围 200 passed |
| collection preflight | 18 failed / 37 passed；批量容量另 2 failed / 56 passed | 最终 preflight 58 passed |
| browser Seal / upload recovery / batch | 47 failed / 27 passed | 7 files / 295 passed |
| desktop / 独立 decrypt 脚本 | 各 5 failed | 各 5 passed |
| deployment / session | 4 failed / 12 passed；有效 env 变化另 1 failed / 6 passed | 最终 config 3 files / 18 passed |
| access / authoring strict runtime context | 2 failed | runtime 联合 6 files / 290 passed |
| 历史 readonly gate | 17 failed / 31 passed | operation 48/48 passed |
| 浏览器静态公开 env 编译 | 实际 bundle 抛 MissingSoulidityEnvError，1 failed | 1 passed |

完整测试首轮暴露的配置 fixture 问题已修复，5 files / 278 passed；没有把 Chrome setup 失败当作通过。最终完整验收结果如下。

## 最终验证与剩余阻塞

- 安装完成标记 `node_modules/.install-done` 出现后才运行依赖命令。
- 最终 `npm test`：exit 1；589 files 中 578 passed / 11 failed；12,447 tests 中 12,142 passed / 0 assertion failed / 305 skipped；另有 3 个 EPIPE unhandled errors。`validate:v6-plan` 和 `prisma:generate` 成功。耗时 302.50 秒。
- 10 个浏览器 suite 在 Chrome 启动/CDP setup 阶段失败，305 项测试因此未执行；独立最小 Chrome 探针也以 SIGABRT 退出。部分旧 teardown 随后 timeout/EPIPE。没有新增 skip、放松断言或修改运行时权限策略。
- `tests/desktop/read-file-xlsx.test.ts` 在 suite 导入时缺少已声明的 `write-excel-file/node`；本轮 root/web 安装没有提供 desktop backend 的 dev dependencies。该失败与 ABI 改动无关。
- 首轮缺少的 `_paired/animacraft` 依赖在并行环境准备后可用，最终对应四项测试通过；本轮没有修改该 peer 工作目录。
- 最终 `npm run typecheck`：exit 0，root + web 均 0 errors。
- 最终 `npx tsc --noEmit -p packages/soulidity-sdk/tsconfig.json`：exit 0，0 errors。
- `git diff --check`：通过。

验收结论：实现及本轮可执行的断言已通过；全量 `npm test` 全绿条件**未满足**。剩余必要动作是在可运行 Chrome 的环境补齐 desktop workspace 的依赖（例如 `pnpm -C desktop install --frozen-lockfile`），然后重新执行用户要求的三个验证命令。不要把 305 个 setup 跳过测试视作通过。

### 复核者重跑（Claude accept，2026-10-24）

上面"未满足"是 codex 沙箱内的结果。Claude 在 worktree 内无沙箱重跑：10 个浏览器 suite 全部通过（Chrome/CDP SIGABRT 为沙箱限制，305 条 setup-skipped 实际全部执行并通过）；`tests/desktop/read-file-xlsx.test.ts` 在按 CI 配方 `pnpm install --frozen-lockfile`（desktop 工作区）后通过。首轮 588/589 suites、12,447 tests；补齐依赖后的确认跑：589/589 suites、12,448/12,448 tests，exit 0（299 s）。`npm run typecheck`、SDK `tsc`、desktop renderer `tsc -p tsconfig.web.json`（`build:shared` / `build:backend` 后）均 0 errors；Move 522/522 未受影响。验收结论：**ACCEPT**，详见审计记录 §11.3。

## 配置与证据边界

- 新增 `protocolGateId` / `NEXT_PUBLIC_SOULIDITY_PROTOCOL_GATE_ID`。两个网络的 manifest 值均为 `""`，env 示例值为空；不会虚构尚未部署的共享对象 ID。显式 env 覆盖优先于 manifest；gated builder 缺失 ID 时明确报错。
- browser/desktop 的 policy、append/recovery、access plan 和 private named-loadout 保存具体 gate，恢复时不会静默采用新环境 gate。production chain env projection 也须携带该字段。
- `web/.env.example` 不存在，已更新根 `.env.example`。
- 未发现直接调用 `grant::issue` / `grant::revoke_scope` 的 TypeScript 调用方；现有对应调用采用 `issue_to_grantee` / `revoke_scope_to_grantee`。未新增无调用方 API。
- 不属于本次 ABI 变化的 profile / Animacraft Seal 入口保持原签名；paid config 继续使用 V2 market wrappers。
- 新包尚未部署，需要发布后填入与新 package/config 对应的 gate ID。本轮没有链上执行、真实 Seal 服务验收、真实钱包签名、提交或推送；没有改动 Move 源码。

## 改动文件清单

- `.env.example`：说明 gate env 空值及 fresh publish 后填入约定，修正 manifest 路径。
- `desktop/apps/desktop/src/renderer/lib/soulidity/content-access.ts`：接收并验证 API gate；四类 Seal PTB 在 document id 后插入 gate。
- `docs/audits/2026-10-24-typescript-abi-sync.md`：记录规格、执行分工、TDD 证据、逐文件清单和验收边界。
- `packages/soulidity-sdk/src/client-session.ts`：部署签名纳入有效 gate，含 env override。
- `packages/soulidity-sdk/src/collection-bind-preflight.ts`：拒绝 native provenance、超费率、primary pause 和批量超供给。
- `packages/soulidity-sdk/src/collection-public-read.ts`：稳定读取 collection 和 V2 market config 供绑定预检。
- `packages/soulidity-sdk/src/deployment-manifest.json`：两个网络新增空字符串 protocolGateId。
- `packages/soulidity-sdk/src/deployment.ts`：deployment 类型新增 protocolGateId。
- `packages/soulidity-sdk/src/env.ts`：gate env 优先于 manifest；静态属性支持浏览器编译，缺失时报错。
- `packages/soulidity-sdk/src/market-errors.ts`：映射新 content、market、collection 和 protocol_gate abort。
- `packages/soulidity-sdk/src/private-named-loadout.ts`：save/update gate 首参，Seal gate 第二参，部署上下文必填。
- `packages/soulidity-sdk/src/tx/collection.ts`：单个和批量绑定改用 V2 market wrapper。
- `packages/soulidity-sdk/src/tx/content.ts`：五类内容 mutation 插入 gate，并保留快照 guards。
- `packages/soulidity-sdk/src/tx/grant.ts`：全部现有 grant mutation 调用插入 gate。
- `packages/soulidity-sdk/src/tx/paid-access.ts`：三个直接 mutation 插入 gate，配置继续用 V2 wrappers。
- `packages/soulidity-sdk/src/tx/publish.ts`：发布时绑定改用 V2 market wrapper。
- `packages/soulidity-sdk/src/types.ts`：sealed accessPolicy 必填 protocolGateId。
- `scripts/sync-vercel-production-env.ts`：公开 env、chain projection 和 required ID 校验包含 gate。
- `tests/backend/production-env-sync.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/browser-content-access.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/browser-content-open.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/browser-content-write-state.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/browser-private-loadout.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/collection-bind-preflight.test.ts`：扩展 provenance、总费率、primary gate、稳定读和批量容量断言。
- `tests/new-web/content-append-browser-export.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/content-append-operation.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/content-append-preparation.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/content-append-rewrap.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/content-mutation-hook.test.tsx`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/content-mutation-store.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/desktop-content-gate-abi.test.ts`：新增 desktop 四类真实 PTB 顺序和缺失 gate 测试。
- `tests/new-web/e2e-agent-content-gate-abi.test.ts`：新增脚本四类 PTB 顺序和缺失 gate 测试。
- `tests/new-web/fixtures/browser-content-access-raw.ts`：同步 gate 配置、共享输入或历史对象 fixture。
- `tests/new-web/fixtures/browser-private-loadout.ts`：同步 gate 配置、共享输入或历史对象 fixture。
- `tests/new-web/fixtures/content-append-operation.ts`：同步 gate 配置、共享输入或历史对象 fixture。
- `tests/new-web/fixtures/content-append-preparation.ts`：同步 gate 配置、共享输入或历史对象 fixture。
- `tests/new-web/fixtures/content-append-store.ts`：同步 gate 配置、共享输入或历史对象 fixture。
- `tests/new-web/fixtures/content-browser-crypto.ts`：同步 gate 配置、共享输入或历史对象 fixture。
- `tests/new-web/fixtures/content-mutation-transaction.ts`：同步 gate 配置、共享输入或历史对象 fixture。
- `tests/new-web/fixtures/content-mutation-ui-runtime.ts`：同步 gate 配置、共享输入或历史对象 fixture。
- `tests/new-web/fixtures/private-named-loadout.ts`：同步 gate 配置、共享输入或历史对象 fixture。
- `tests/new-web/fixtures/soul-access-raw.ts`：同步 gate 配置、共享输入或历史对象 fixture。
- `tests/new-web/fixtures/soul-access-transaction.ts`：同步 gate 配置、共享输入或历史对象 fixture。
- `tests/new-web/fixtures/soul-authoring-completion-browser.ts`：同步 gate 配置、共享输入或历史对象 fixture。
- `tests/new-web/fixtures/soul-authoring.ts`：同步 gate 配置、共享输入或历史对象 fixture。
- `tests/new-web/market-errors.test.ts`：扩展新 abort 的简写与 SDK 格式翻译断言。
- `tests/new-web/private-loadout-controller.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/private-loadout-history.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/private-loadout-transaction.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/private-named-loadout.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/protocol-gate-runtime-context.test.ts`：新增 access/authoring 严格配置和缺失 gate 测试。
- `tests/new-web/sdk-access-mutation-snapshot.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/sdk-collection-bind-abi.test.ts`：新增单个/批量 V2 wrapper 参数与缺失 config 测试。
- `tests/new-web/sdk-content-append-envelope.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/sdk-content-mutation-snapshot.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/sdk-content-u64-index.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/sdk-grant-batch-builders.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/sdk-initial-content-mint.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/sdk-protocol-gate-builders.test.ts`：新增 24 项 SDK gate ABI 与缺失 gate 回归。
- `tests/new-web/soul-access-hook.test.tsx`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/soul-access-operation.test.ts`：新增历史 gate 证据与缺失/伪造/暂停/版本错误回归。
- `tests/new-web/soul-access-ui-export.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/soul-authoring-kiosk.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/soul-authoring-manifest.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/soul-authoring-preparation.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/soul-content-family-access.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/soulidity-client-session.test.ts`：验证 manifest/env gate 变化使旧部署签名失效。
- `tests/new-web/soulidity-deployment.test.ts`：验证双网络空 gate、loader fallback、env override 和缺失报错。
- `tests/new-web/soulidity-gate-browser-env.test.ts`：新增实际浏览器 bundle 中静态公开 gate env 测试。
- `tests/new-web/walrus-batch-durable-store.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/new-web/walrus-batch-seal.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/scripts/native-e2e-env.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `tests/scripts/native-production-env.test.ts`：同步 gate/wrapper 上下文与参数断言，保留既有回归约束。
- `web/app/api/collections/[id]/add-soul/route.ts`：确认无 PTB 构建；修正说明中的新钱包入口。
- `web/app/resources/smart-contracts/page.tsx`：文档同步 V2 绑定约束和 listed 写入冻结。
- `web/app/resources/user-guide/page.tsx`：用户指南说明新入口与取消 listing 后编辑。
- `web/lib/animacraft/browser-private-loadout.ts`：配置读取与捕获 gate。
- `web/lib/animacraft/private-loadout-controller.ts`：保存操作传递已捕获 gate。
- `web/lib/animacraft/private-loadout-recovery.ts`：恢复记录核对 gate 配置一致性。
- `web/lib/animacraft/private-loadout-transaction.ts`：交易角色和 gas 排除集合纳入 gate。
- `web/lib/hooks/use-publish.ts`：捕获 authoring gate，并传递绑定候选预检信息。
- `web/lib/hooks/use-soul-access-mutations.ts`：access 操作部署上下文保存 gate。
- `web/lib/hooks/use-soul-content-append.ts`：append 准备范围保存 gate。
- `web/lib/hooks/use-soul-content-mutations.ts`：内容 mutation 捕获并核对 gate。
- `web/lib/soulidity/access.ts`：服务端 Seal accessPolicy 输出 gate。
- `web/lib/soulidity/browser-content-access.ts`：浏览器配置和访问 policy 传递 gate。
- `web/lib/soulidity/browser-content-open.ts`：四类 Seal PTB 在 id 后插入 gate。
- `web/lib/soulidity/browser-content-write-state.ts`：写入配置和观测快照保存 gate。
- `web/lib/soulidity/content-append-operation.ts`：append 交易、恢复与历史共享对象角色纳入 gate。
- `web/lib/soulidity/content-append-preparation.ts`：严格准备范围和 upload recovery Seal 调用纳入 gate。
- `web/lib/soulidity/content-append-rebase-evidence.ts`：rebase 证据核对 gate 不漂移。
- `web/lib/soulidity/content-mutation-transaction.ts`：严格 plan、PTB 重建和 authority 核验纳入 gate。
- `web/lib/soulidity/soul-access-history.ts`：核验执行时历史 readonly gate 的完整 Object 证据。
- `web/lib/soulidity/soul-access-operation.ts`：SDK 调用与保存交易的共享角色传入 gate。
- `web/lib/soulidity/soul-access-plan.ts`：严格部署 schema 和别名排除包含 gate。
- `web/lib/soulidity/soul-authoring-manifest.ts`：authoring target 与 batch Seal context 包含 gate。
- `web/lib/soulidity/soul-authoring-transaction.ts`：authoring 绑定使用 V2 market wrapper。
- `web/lib/upload/walrus-batch-seal.ts`：batch context 和 upload recovery Seal 调用包含 gate。
- `web/scripts/e2e-agent-decrypt.ts`：独立脚本四类内容 Seal PTB 同步新顺序。
