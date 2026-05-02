# 调研：用 nami.cloud 替代 Walrus 上传的可能性

> 用户已确认：**仅调研，本轮不动代码**；生产环境主跑 **mainnet**。
> 本文是研究交付，不含实施步骤；如后续要落地，可按"可插入点"清单单独立任务。

## Context

ClawNews 当前所有 Soul 内容（content / memory / skills / assets / sprite / voice）走 Walrus 公共 publisher 上传 + 公共 aggregator 下载。痛点：

- **下载延迟**：默认 aggregator 无 CDN，全球延迟高
- **运维**：mainnet 续期、配额需要自己管
- **可靠性**（mainnet 影响相对小，但留作背景）：testnet 时代社区 publisher 频繁 413/429，已通过 4 节点轮询缓解（`web/lib/services/walrus.ts:18-22` 注释记录）

调研 nami.cloud 能否解决这些问题、能否整段替换 Walrus。

## 关键结论（先看这一段）

**nami.cloud 不是 Walrus 的替代，而是 Walrus 之上的托管 publisher / S3 / CDN 服务**（Walrus 官方 blog 有合作公告）。

- 数据仍然存在 Walrus 网络
- 链上 `walrus::blob::Blob` 类型不变
- `blobId` 编码不变（任意 aggregator 可读）

所以"用 nami 替代 walrus 上传"在我们这个仓库里，等价于**把指向 walrus.space 公共节点的 URL 换成 nami.cloud 自营节点**。**绝大部分代码不用动**——`walrus.ts:88-89` 已经留了 `WALRUS_PUBLISHER_URL` / `WALRUS_AGGREGATOR_URL` 两个 env 覆盖位。

## 三个可插入点

### 选项 A — Aggregator 切到 Nami（强推，零成本，零代码）

| 维度 | 说明 |
|------|------|
| 做法 | prod env 设 `WALRUS_AGGREGATOR_URL` 指向 Nami 加速 aggregator host |
| 影响代码 | 无；`walrus.ts:99-104` 自动读 env 并缓存 |
| 收益 | Nami "Railgun" 加速：5-10s → 几百 ms（官方数据），sprite/voice/asset 加载体验显著提升 |
| 成本 | Free tier（10 req/s, 100k credits/月）；超量再上 $50/月 Standard |
| 风险 | 低。CDN 故障可秒切回 walrus.space |
| 待核校 | 老 DB 行里若残留旧 aggregator URL，`extractBlobIdFromWalrusUrl()`（`walrus.ts:114-130`）会因 origin 不匹配解析失败；新数据没问题 |

### 选项 B — HTTP Publisher 切到 Nami（中等收益，订阅费，零代码）

| 维度 | 说明 |
|------|------|
| 做法 | prod env 设 `WALRUS_PUBLISHER_URL=https://walrus-mainnet-publisher.nami.cloud/${endpoint_key}` |
| 兼容性 | 完全兼容：PUT 方法、`/v1/blobs` 路径（拼在 base 之后即可）、`send_object_to` query、响应 `newlyCreated.blobObject.blobId` / `alreadyCertified.blobId` 与现有 `WalrusStoreResponse` 完全对齐 |
| 当前调用面 | 仅 server-side + E2E：`web/scripts/e2e-sprite-lifecycle.ts:350`、`web/scripts/e2e-public-sprite-anonymous.ts`、所有 server 路径调用 `uploadEncrypted()` / `uploadPublic()`。`/api/souls/upload` 已退役（410）。**生产用户走的是钱包付费 SDK，不走这条** |
| 成本 | $50/月含 50GB 链上存储；超量计费需联系 sales（pricing 页未公开 per-GB） |
| 安全 | `endpoint_key` 嵌在 URL path 里 = 等同密码。**只能放 server-side env，绝不能下发到 `NEXT_PUBLIC_*`** |
| 风险 | 中：账号配额耗尽 → 上传失败。建议轮询保留 walrus.space publisher 作 fallback；当前 `walrus.ts:88-98` 是"独占式"覆盖（设 env 就只用一家），需小改成"Nami 优先 + 公共 fallback"才安全 |

### 选项 C — 浏览器钱包付费 SDK 路径（建议暂不动）

生产用户实际走 `web/lib/upload/client-upload.ts:186` `uploadSingleBlob()` → `@mysten/walrus` SDK 的 `client.writeBlobFlow()`：用户钱包 register → upload-relay 转发字节 → 用户钱包 certify。upload-relay 当前是 `https://upload-relay.testnet.walrus.space`（env: `NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL`，mainnet 对应 host 类似）。

Nami 文档（`docs.nami.cloud/llms.txt`）只列了 Publisher / Aggregator / S3，**没有 upload-relay 协议条目**。要切的话需要找 contact@nami.cloud 确认；选项 A+B 已能覆盖大多数痛点，C 优先级最低。

## 不变的部分（与存储后端解耦）

以下层对 publisher / aggregator 是谁完全无感，**不用改**：

- `@mysten/seal` 加密层（`web/lib/upload/client-seal.ts`）：加密在上传前完成
- Move 链上结构（`move/soulidity/sources/{soul,assets,skills,memory}.move`）：`walrus::blob::Blob` 类型与来源无关
- DB schema（`prisma/schema.prisma` `blobId` / `blobObjectId` 列）：字符串字段，厂商无关
- Recovery key 流（`web/lib/upload/`）：跟踪 plaintext hash + blobId
- ContentAccessList / Grant / Seal 文档 ID 校验逻辑：不变

## Mainnet 落地前必须确认的几件事

1. **Nami aggregator 准确 hostname** — 文档没列具体 host，需要注册 dashboard 获取（mainnet 命名规律应类似 `walrus-mainnet-aggregator.nami.cloud`）
2. **rate limit 是否够用** — Free tier 10 req/s，看一次批量 publish 会触发多少请求；批量上传 sprite + voice + assets 一次可能就接近上限
3. **续期机制** — Nami 官方说"自动管理 on-chain 续期"，但默认 publisher API 调用是否生效？Standard tier "50GB 链上存储" 是否包含续期费？需问 sales
4. **`endpoint_key` 轮换 / 撤销** — 一旦泄露怎么撤销？是否支持多 key（dev / prod 隔离）？
5. **mainnet publisher 的 max body size** — 当前我们对 sprite 设 50 MiB 单 blob 上限（`web/lib/upload/client-upload.ts`），>50 MiB 自动 16 MiB 分片。Nami publisher 上限文档未列，需实测

## 附录：当前 Walrus 集成关键路径

| 模块 | 文件 | 说明 |
|------|------|------|
| HTTP publisher 客户端 | `web/lib/services/walrus.ts:241-329` | `putWalrusBlob()`，4 节点轮询、重试、超时 |
| 上传 API | `web/lib/services/walrus.ts:335-353` | `uploadEncrypted()` / `uploadPublic()` |
| 下载 URL 拼装 | `web/lib/services/walrus.ts:358-360` | `getBlobUrl()` |
| 浏览器钱包付费上传 | `web/lib/upload/client-upload.ts:186` | `uploadSingleBlob()` via `@mysten/walrus` SDK |
| 加密层 | `web/lib/upload/client-seal.ts:87` | `encryptClientSide()`，AES-GCM + Seal sidecar |
| env 覆盖位 | `web/lib/services/walrus.ts:88-89` | `WALRUS_PUBLISHER_URL` / `WALRUS_AGGREGATOR_URL` |
| 测试 | `tests/web/walrus-service.test.ts` | publisher 轮询、retry、`send_object_to` |

## Sources

- [nami.cloud — Introducing Nami Cloud blog](https://nami.cloud/blog/introducing-nami-cloud-the-decentralized-future-of-cloud-storage)
- [docs.nami.cloud — Walrus Publisher Store Blob](https://docs.nami.cloud/api-reference/walrus/publisher-store-blob)
- [docs.nami.cloud — Introduction](https://docs.nami.cloud/introduction)
- [walrus.xyz blog — Nami Cloud builds cloud infra on Walrus](https://www.walrus.xyz/blog/nami-cloud-builds-cloud-infra-on-walrus)
- [raptorgroup.com — First publisher & S3-compatible storage on Walrus](https://www.raptorgroup.com/news/introducing-first-publisher-s3-compatible-decentralized-storage-solution-on-walrus/)
- [nami.cloud pricing](https://nami.cloud/pricing)
