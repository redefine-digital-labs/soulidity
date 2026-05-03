# Soulidity 2-Signature Fast Path Required Runbook

## Goal

把 Soulidity mint、collection、listing、skills/assets 初始化这些会被 PTB 串起来的入口统一改成“返回未 share 原语对象 + 显式 finalize”，并在同一轮完成 Move、TS builders、hooks、UI、recovery、测试、mainnet 发布与 smoke。完成后用户不再遇到 collection + N souls、单 soul 绑定 collection、立刻挂单、skills/assets 首次初始化被拆成多次签名的问题。

## Baseline

This runbook applies on top of:

- Latest committed HEAD: `a7d107b` (`fix(web): use personal_kiosk package id for mainnet cap filter`).
- Plus the current uncommitted working-tree diff (15 files, ~1100 insertions / ~600 deletions). The diff is the groundwork for this plan: it adds `extractAllSoulMintedToKioskEvents` / `extractAllSoulAddedToCollectionEvents` in `events.ts`, multi-event handling in `/api/souls/publish` and `/api/collections/[id]/add-soul`, batch-mint/bind plumbing in `tx/publish.ts` and `tx/collection.ts`, and a v11 hook restructure in `use-collection-publish.ts`. Recovery is still v11 in this baseline; ABI is still pre-finalize.

Before implementing this runbook, land the uncommitted diff as a single groundwork commit (`groundwork(soulidity): batch event extraction + multi-event mirror routes`) and treat that commit as the baseline. Do not start the ABI break with a dirty working tree.

## Current Repo Truth

- `move/soulidity/sources/market.move` 里的 `mint_native_in_personal_kiosk`、`mint_imported_in_personal_kiosk`、`mint_joined_in_personal_kiosk<T>` 当前内部直接 `soul::share_state(state)`，返回 `soul_id: ID`。
- `create_collection_in_personal_kiosk` 当前内部 `collection::share_collection(collection_obj)`，返回 `collection_id: ID`。
- `list_soul_fixed_price`、`list_soul_fixed_price_with_collection`、`list_collection_right_fixed_price` 当前内部 `transfer::share_object(listing)`，返回 listing ID，并要求调用方传入 `soul_id` 或 `right_id`。
- `init_assets_and_append_sprite_as_owner` 与 `init_skills_and_append_as_owner` 当前内部 share root object，首次创建后无法继续在同一 PTB 追加更多版本。
- `web/lib/upload/client-upload.ts` 的 batch Walrus 路径现在把 register PTB 签名封装在 `prepareSoulBlobsForBatchPublish` 内部；要把 register 和 create_collection 合并到同一笔 PTB，必须先把“准备/注册/注册后上传和 cert”拆开。
- `web/lib/hooks/use-collection-publish.ts` 当前 recovery 版本是 v11，流程是 register all blobs -> create collection -> chunked mint -> chunked bind。
- `scripts/publish-soulidity-and-sync.ts` 已支持 `--mainnet-e2e` publish-only、`--resume-cap-transfer-from-manifest`、`--transfer-caps-to`，并会写 `web/lib/soulidity/deployment-manifest.json` 与 `move/soulidity/Published.toml`。

## Required Acceptance

| Workflow | Required signatures |
|---|---:|
| Empty collection | 2 |
| Empty collection + collection-right listing | 2 |
| Collection + N souls within dry-run limits | 2 |
| Collection + N souls + collection-right listing within dry-run limits | 2 |
| Collection + N souls above dry-run limits | PTB1 plus chunked mint/bind path |
| Single soul publish | 2 |
| Single soul + existing collection bind | 2 |
| Single soul + soul listing | 2 |
| Single soul + collection bind + soul listing | 2 |
| First skills root + N skill versions | 2 |
| First assets root + N sprite versions | 2 |

## Design Rules

- Keep the same public function names where callers already use them, but change the ABI return shape. Do not keep old duplicate ABI routes.
- Do not introduce hot-potato carrier structs, borrowed carrier accessors, or Move-side combination helpers such as `mint_and_bind` / `create_collection_with_souls`.
- Move exposes only primitive object returns plus one-line `finalize_*` wrappers. All workflow composition lives in TypeScript PTBs.
- Mint functions share non-chained child objects inside mint: metadata, memory, skills, assets, and content access. Only `SoulState` is returned for PTB chaining.
- Listing functions emit listing events when creating the listing object; `finalize_*_listing` only shares the listing object.
- Collection functions emit collection events when creating the collection object; `finalize_collection` only shares the collection object.
- Walrus register can be composed into collection PTB1, but `certify_blob` cannot run until after PTB1 is signed and the slivers are uploaded. Therefore every collection launch has a required post-PTB1 certify step: cover-only for empty collections, cover + all soul blobs in fast PTB2, or cover in the first chunked mint PTB.
- Mainnet release uses publish-only, smoke, then Cap handoff. Cap handoff does not run before smoke passes.
- The new `finalize_*` wrappers exist only on the new package. Souls, Collections, Skills, and Assets that were already shared on the previous mainnet package keep working through their existing append/list/buy entry points; those entry points never call a `finalize_*` wrapper because the root object is already shared. New `finalize_*` is only relevant when the root is being created in the same PTB (mint, create_collection, init_skills, init_assets, list_*).
- After this release, freeze breaking on-chain ABI changes for 60 days. The previous mainnet republish (`601e9d1`, max_supply, 2026-05-03) is one ABI break. This runbook is the second. Future ABI work batches into a single subsequent release.

## Required Implementation

### 1. Move Contract ABI

Modify `move/soulidity/sources/market.move`.

Change these functions to return by-value primitive objects:

| Function | New return | Internal share changes |
|---|---|---|
| `mint_native_in_personal_kiosk` | `SoulState` | keep child shares, remove `soul::share_state(state)` |
| `mint_imported_in_personal_kiosk` | `SoulState` | same |
| `mint_joined_in_personal_kiosk<T>` | `SoulState` | same |
| `create_collection_in_personal_kiosk` | `SoulCollection` | remove `collection::share_collection(collection_obj)` |
| `list_soul_fixed_price` | `SoulListing` | remove listing share, remove `soul_id` arg, read `soul::soul_id(state)` |
| `list_soul_fixed_price_with_collection` | `SoulListing` | remove listing share, remove `soul_id` arg, read `soul::soul_id(state)` |
| `list_collection_right_fixed_price` | `CollectionListing` | remove listing share, remove `right_id` arg, read `collection::right_id(collection_obj)` |
| `init_skills_and_append_as_owner` | `SoulSkills` | set `skills_id`, return root, remove internal share |
| `init_assets_and_append_sprite_as_owner` | `SoulAssets` | set `assets_id`, return root, remove internal share |

Add exactly these finalize wrappers in `market.move`:

```move
public fun finalize_soul_state(state: SoulState) {
    soul::share_state(state)
}

public fun finalize_collection(collection_obj: SoulCollection) {
    collection::share_collection(collection_obj)
}

public fun finalize_soul_listing(listing: SoulListing) {
    transfer::share_object(listing)
}

public fun finalize_collection_listing(listing: CollectionListing) {
    transfer::share_object(listing)
}

public fun finalize_soul_skills(skills_book: SoulSkills) {
    skills::share_skills(skills_book)
}

public fun finalize_soul_assets(assets_book: SoulAssets) {
    assets::share_assets(assets_book)
}
```

Update `move/soulidity/sources/protocol_tests.move` helper functions so old tests can keep asking for IDs:

```move
fun mint_native_in_personal_kiosk_compat(...): ID {
    let state = market::mint_native_in_personal_kiosk(...);
    let soul_id = soul::soul_id(&state);
    market::finalize_soul_state(state);
    soul_id
}
```

Use the same pattern for collection helpers:

```move
let collection_obj = market::create_collection_in_personal_kiosk(...);
let collection_id = object::id(&collection_obj);
market::finalize_collection(collection_obj);
```

### 2. Walrus Batch Helper Split

Modify `web/lib/upload/client-upload.ts`.

Extract the current batch helper into three explicit phases:

1. `prepareBatchWalrusRegisterIntent(params)`
   - validates files, encrypts payloads, builds the aggregate cost quote, encodes blobs, computes `blobId` / `rootHash`, and returns stable blob URLs before any wallet signature.
   - returns `appendRegisterCalls(tx)` that adds `client.registerBlob(...)` calls and `tx.transferObjects(...)` for every registered Blob object.

2. `completeBatchWalrusUploadAfterRegister(params)`
   - accepts the signed PTB1 digest and the prepared intent.
   - resolves Blob object IDs from `objectChanges`, persists batch recovery immediately, uploads encoded slivers to storage nodes, builds certificates, and returns `files`, `registerTxDigest`, `attachCertifyCalls(tx, indices)`, and `clearBatchRecovery()`.

3. `prepareSoulBlobsForBatchPublish(params)`
   - becomes a wrapper over the two functions above for callers that still need the existing register-then-certify shape.

`use-collection-publish.ts` must use the split helpers directly so collection PTB1 can contain both Walrus register and collection creation.

### 3. Transaction Builders

Modify `web/lib/soulidity/tx/publish.ts`.

- Change `appendMintNativeMoveCall` to return the `TransactionResult` for `SoulState`.
- `buildPublishSoulTx` must call `mint_native_in_personal_kiosk` and then `market::finalize_soul_state`.
- Add `buildPublishSoulWithBindTx`:
  - mint returns `state`
  - call `collection::add_soul(tx.object(collectionId), state)`
  - call `market::finalize_soul_state(state)`
- Add `buildPublishSoulWithListTx`:
  - mint returns `state`
  - call `market::list_soul_fixed_price(..., state, price)`
  - call `market::finalize_soul_listing(listing)`
  - call `market::finalize_soul_state(state)`
- Add `buildPublishSoulWithCollectionAndListTx`:
  - mint returns `state`
  - bind to existing collection
  - call `market::list_soul_fixed_price_with_collection(..., state, tx.object(collectionId), price)`
  - finalize listing, then state
- Change `buildBatchPublishSoulTx` so every mint call finalizes the returned state.
- Add `buildCollectionFastPathPtb2Tx` for PTB2 of collection launch:
  - accepts `collectionOnChainId`
  - rejects `souls.length === 0`
  - attaches the cover cert call plus every soul cert call
  - loops `mint -> collection::add_soul -> finalize_soul_state`

Modify `web/lib/soulidity/tx/collection.ts`.

- `buildCreateCollectionTx` must call `create_collection_in_personal_kiosk` and `finalize_collection`.
- Add `appendCreateCollectionMoveCalls(tx, params)` for PTB1 composition. It returns the unshared `SoulCollection` handle.
- Add `buildCreateCollectionWithListTx`:
  - create collection returns `collection`
  - list collection right using `collection`
  - finalize listing
  - finalize collection
- Add `buildCollectionCoverCertifyTx` for empty collection launches:
  - accepts `attachCertifyCalls(tx, [coverIndex])`
  - performs no Soulidity Move calls
  - exists only to land the cover blob certificate as the second required signature for empty collection and empty collection + listing workflows
- `buildAddSoulToCollectionTx` and `buildBatchAddSoulToCollectionTx` stay as shared-object routes for existing post-mint binds and chunked fallback.

Modify `web/lib/soulidity/tx/list.ts`.

- `buildListSoulTx` must call the new list ABI and then `finalize_soul_listing`.
- `buildListCollectionTx` must call the new collection-list ABI and then `finalize_collection_listing`.
- Remove `soulObjectId` and `rightObjectId` from builder params where Move can derive the ID from state or collection.

Modify `web/lib/soulidity/tx/skills.ts`.

- `buildInitSkillsAndAppendAsOwnerTx` must finalize the returned root.
- Add `buildInitAndBatchAppendSkillsTx`:
  - call `market::init_skills_and_append_as_owner` for the first blob
  - call `skills::append_version_as_owner` for every extra version
  - call `market::finalize_soul_skills`

Modify or create `web/lib/soulidity/tx/assets.ts`.

- Add `buildInitAndBatchAppendAssetsTx`:
  - call `market::init_assets_and_append_sprite_as_owner` for the first sprite version
  - call `assets::append_version_as_owner` for every extra version
  - upsert metadata blobs and active sprite binding for every appended sprite version that becomes active
  - call `market::finalize_soul_assets`

### 4. Hook and UI Integration

Modify `web/lib/hooks/use-publish.ts`.

- Extend `PublishParams` with:
  - `collectionBindTarget`
  - `listOnPublish: boolean`
  - `listingPriceAtomic: string | null`
- Select the correct builder:
  - no bind, no listing: `buildPublishSoulTx`
  - bind only: `buildPublishSoulWithBindTx`
  - listing only: `buildPublishSoulWithListTx`
  - bind and listing: `buildPublishSoulWithCollectionAndListTx`
- Mirror in this order using the same digest when the PTB contains multiple events:
  - `/api/souls/publish`
  - `/api/collections/:collectionOnChainId/add-soul` with `txDigest` and `soulOnChainId`
  - `/api/souls/:soulOnChainId/list` with `txDigest`
- Each of the three routes must accept a digest whose underlying TX contains additional unrelated events (mint + bind + list in one PTB) and isolate its own event by `soul_id` / `collection_id`.
- Add `extractAllSoulListedEvents` in `web/lib/soulidity/events.ts`; update `/api/souls/[id]/list/route.ts` to select the `SoulListed` event whose `soul_id` matches the route Soul. This repo currently extracts only the first `SoulListed` event, which is not acceptable for same-digest mint+bind+list.
- Add `extractAllCollectionListedEvents` in `web/lib/soulidity/events.ts`; update `/api/collections/[id]/list/route.ts` to select the `CollectionListed` event whose `collection_id` matches the route collection. This keeps collection create+list robust when the TX contains unrelated events.
- Delete the second-signature bind branch from the publish hook.

Modify the create-soul pages/providers that feed `use-publish.ts`.

- Add visible controls for binding to an existing collection and setting an immediate listing price before the final wallet signature.
- The success page must reflect the actual outcome: unlisted, bound, listed, or bound-and-listed.
- The development E2E helpers in `web/app/create/gas/page.tsx` must use the new builders and must not require a separate list or bind TX for the optimized flows.

Modify `web/lib/hooks/use-collection-publish.ts`.

- Bump recovery to v12.
- PTB1:
  - call `prepareBatchWalrusRegisterIntent`
  - build one `Transaction`
  - append all Walrus register calls
  - create collection with the precomputed cover blob URL
  - when the user chooses collection-right listing at launch, list it in the same PTB
  - finalize listing when present
  - finalize collection
  - sign and persist `collectionPtb1Digest`
- After PTB1:
  - install a `beforeunload` guard for the duration of the sliver upload + cert phase; show a sticky “do not close this tab” progress UI. Clear the guard once `completeBatchWalrusUploadAfterRegister` resolves.
  - call `completeBatchWalrusUploadAfterRegister`
  - wait for `collectionPtb1Digest` to reach finality on chain (`waitForTransactionBlock` with `showEffects` so we know the shared `SoulCollection` and any included `CollectionListing` have an `initialSharedVersion`). PTB2 dry-run requires this version on the input object.
  - mirror collection create using `collectionPtb1Digest`
  - mirror collection listing using `collectionPtb1Digest` when listing was included
- Empty collection PTB2:
  - when `souls.length === 0`, build `buildCollectionCoverCertifyTx`, attach only the cover certificate, sign once, persist `coverCertifyDigest`, and then clear batch recovery
  - do not run `buildCollectionFastPathPtb2Tx` and do not enter chunked fallback for empty collections
- PTB2 fast path:
  - build `buildCollectionFastPathPtb2Tx`
  - attach the cover certificate plus all soul certificates in this PTB; if the fast path signs successfully, set `coverCertifyDigest = fastPathPtb2Digest`
  - resolve the sender from the connected wallet, set `tx.setSender(sender)` and `tx.build({ client: suiClient, onlyTransactionKind: false })` to materialize bytes
  - run an **explicit** `suiClient.dryRunTransactionBlock({ transactionBlock: bytes })`. Do not rely on the wallet’s internal dry-run for the fast/chunked decision — it runs after the wallet UI has already committed.
  - require:
    - `dryRunResult.effects.status.status === 'success'`
    - `bytes.length <= NEXT_PUBLIC_SOULIDITY_FAST_PATH_BYTES_CAP` (default `96000`, i.e. 75% of Sui's 128KB max-tx-size)
    - `Number(dryRunResult.effects.gasUsed.computationCost + dryRunResult.effects.gasUsed.storageCost) <= NEXT_PUBLIC_SOULIDITY_FAST_PATH_GAS_CAP_MIST` (default `5_000_000_000`, i.e. 5 SUI)
  - dry-run failure routing:
    - `dryRunResult.effects.status` failure with `error` mentioning a missing/changed object → recovery is corrupt; clear `fastPathPtb2Digest`, surface to user as “session expired, please retry from the start”, do not auto-fall to chunked
    - `bytes.length` over cap or `gasUsed` over cap or any other dry-run failure → fall back to chunked
  - on success: sign once, persist `fastPathPtb2Digest`, then mirror every soul + bind via the new `/api/souls/publish/batch` route (see D5 below). One mirror RPC for the whole digest, not one per soul.
  - if signAndExecute itself fails or PTB2 lands but `effects.status === 'failure'`: bump `fastPathAttempt.count`. After one failure, fall through to chunked fallback. Persist `fastPathAttempt` in recovery.
- Chunked fallback:
  - reuse the PTB1 collection ID
  - mint chunks with `buildBatchPublishSoulTx`
  - attach the cover certificate to the first unsigned mint chunk and persist `coverCertifyDigest` to that chunk digest; subsequent chunks certify only their own soul blobs
  - bind chunks with `buildBatchAddSoulToCollectionTx`
  - keep the existing chunk mirror behavior, but use the new `/api/souls/publish/batch` route to mirror each chunk in one RPC instead of N
- Mirror batch route:
  - add `POST /api/souls/publish/batch` accepting `{ txDigest, collectionOnChainId, expectedSoulCount, expectedBindCount, syncBodies: PublishSyncBody[] }`
  - server reads the TX once, runs `extractAllSoulMintedToKioskEvents` + `extractAllSoulAddedToCollectionEvents`, validates counts match `expected*`, validates all bind events point to `collectionOnChainId`, then writes all soul + bind mirror rows and the collection supply projection. Atomicity is provided through TX-digest dedup (`storeSoulidityTxSync` keyed on `(routeKey, txDigest, actorKey, resourceKey)`) plus idempotent sync helpers — wrapping the loop in `prisma.$transaction` is **rejected** because each iteration performs Walrus blob-id lookups and Sui object reads, and a 12-soul fast-path would hold a multi-second DB transaction. Partial failures resume cleanly because the same digest replays produce the same rows.
  - existing per-soul `/api/souls/publish` and `/api/collections/:id/add-soul` stay as-is for the single-soul flow in `use-publish.ts`

Modify collection create pages/providers.

- `web/components/providers/create-collection-provider.tsx` must carry collection-right listing intent and price through refresh recovery.
- `web/app/collections/create/page.tsx` must let a creator list the collection right during launch.
- `web/app/collections/create/preview/page.tsx` must pass the listing intent to `useCollectionPublish`.
- `web/app/collections/create/success/page.tsx` must display whether collection-right listing was created in PTB1.

Modify `web/lib/hooks/use-assets.ts`.

- Use `buildInitAndBatchAppendAssetsTx` when the user uploads a first sprite root plus more versions in one action.
- Keep the existing live-chain `SoulState.assets_id` preflight and `EAssetsRootAlreadyExists` retry guard.

Modify skills UI/API entry points that call `buildInitSkillsAndAppendAsOwnerTx`.

- Use `buildInitAndBatchAppendSkillsTx` when the user uploads first root plus more versions in one action.
- Keep single-version behavior as a one-version call through the same builder.

### 5. Recovery v12 Shape

Replace collection launch recovery with:

```typescript
type RecoveryState = {
  version: 12
  userId: string
  draftSignature: string | null
  collectionPtb1Digest: string | null
  coverCertifyDigest: string | null
  collectionData: CollectionSyncResponse | null
  // PTB1 may include the collection-right listing in the same TX. When it
  // does, the listing event lives at `collectionPtb1Digest`; there is no
  // separate listing digest. `priceAtomic === null` means listing was not
  // requested for this draft.
  collectionRightListing: { priceAtomic: string; includedInPtb1: true } | null
  fastPathPtb2Digest: string | null
  fastPathAttempt: { count: number; lastError: string | null } | null
  uploadedImageUrl: string | null
  collectionMeta: CollectionRecoveryMeta | null
  souls: RecoverySoulState[]
  mintChunks: ChunkRecovery[]
  bindChunks: ChunkRecovery[]
}
```

v11 drafts are discarded on version mismatch (verified by a regression test that loads a v11 blob and asserts it is purged). v12 resume must never sign a second PTB1 for the same draft signature while `collectionPtb1Digest` is present. If `coverCertifyDigest` is null after `collectionPtb1Digest` is present, resume must require the original local files and continue from cover/soul certification without re-registering blobs. If local files needed for cert calls are gone after refresh, surface a recovery error that asks the user to reselect the same files; do not re-register blobs automatically. If `fastPathAttempt.count >= 1`, resume goes directly into the chunked fallback path and never re-attempts the fast path for this draft.

### 6. Tests

Move tests in `move/soulidity/sources/protocol_tests.move`:

- Update all existing helpers and call sites for the new return ABI.
- Add `test_create_collection_with_souls_fast_path`.
- Add `test_single_soul_publish_with_bind`.
- Add `test_publish_soul_with_list`.
- Add `test_publish_soul_with_collection_and_list`.
- Add `test_create_collection_with_list`.
- Add `test_init_and_batch_append_skills`.
- Add `test_init_and_batch_append_assets`.
- Do not add invalid resource-drop tests. Missing finalization is enforced by Move resource semantics and by TS builder tests that assert finalizer calls are present.

Move tests must land in two commits:

- C1 (Move helper migration only): rewire all existing helpers/call sites to the new return ABI, no new tests. `sui move build` and `sui move test` must be green at this commit before any new test is added.
- C2 (new tests): add the seven new tests listed above.

This keeps blame-by-bisect useful and prevents mixing helper churn with new coverage.

TS builder tests in `tests/new-web/soulidity-tx-builders.test.ts`:

- Update `buildPublishSoulTx` command assertions to include `finalize_soul_state`.
- Add coverage for `buildPublishSoulWithBindTx`, `buildPublishSoulWithListTx`, and `buildPublishSoulWithCollectionAndListTx`.
- Update `buildBatchPublishSoulTx` command assertions to include one finalizer per mint.
- Update `buildCreateCollectionTx` to include `finalize_collection`.
- Add `buildCollectionFastPathPtb2Tx` command sequence assertions (cover cert → cert(N) → mint(N) → add_soul(N) → finalize_soul_state(N) ordering).
- Add `buildCollectionCoverCertifyTx` command assertions for the empty collection second signature.
- Add `buildCreateCollectionWithListTx` command sequence assertions (create → list → finalize_collection_listing → finalize_collection ordering).
- Update `buildListSoulTx` and `buildListCollectionTx` for derived ID params and listing finalizers.
- Add skills/assets batch builder assertions.

Add `tests/new-web/walrus-batch-helper-split.test.ts`:

- `prepareBatchWalrusRegisterIntent` returns stable blob URLs and an `appendRegisterCalls(tx)` callable; calling `appendRegisterCalls` twice on different `Transaction` instances produces structurally identical command sequences.
- `completeBatchWalrusUploadAfterRegister` rejects when `objectChanges` is missing the expected number of created `Blob` objects.
- Sliver upload failure mid-flight leaves the recovery row intact and re-runnable; success path calls `clearBatchRecovery()`.

Hook and integration tests:

- Add `tests/new-web/collection-fast-path-regressions.test.ts`.
- Cover PTB1 register+create ordering and PTB1 with collection-right listing in the same TX.
- Cover empty collection second signature: `buildCollectionCoverCertifyTx` signs once, persists `coverCertifyDigest`, clears batch recovery, and makes the cover image resolvable after certify.
- Cover chunked fallback cover cert placement: first unsigned mint chunk includes the cover cert exactly once; subsequent chunks do not repeat it.
- Cover fast-path dry-run success route (mirror via `/api/souls/publish/batch`, one RPC per chunk/PTB).
- Cover dry-run failure (over byte cap) → chunked fallback, recovery records `fastPathAttempt`.
- Cover signAndExecute failure on PTB2 → recovery bumps `fastPathAttempt.count`, resume goes to chunked.
- Cover dry-run failure (object missing) → surfaced as session error, no fallback.
- Cover v12 resume with `collectionPtb1Digest` present.
- Cover v11 → v12 migration: a persisted v11 blob is dropped and the user starts from scratch.
- Cover no second bind TX in `use-publish.ts`. **CRITICAL regression test** — pin via assertion that the hook never calls `signAndExecute` more than once per `publish()` invocation.
- Cover same-digest mirror calls for mint+bind+list and the new `/api/souls/publish/batch` route shape.
- Cover `extractAllSoulListedEvents` and `extractAllCollectionListedEvents`, including route-level selection by route Soul/collection ID when the same TX contains unrelated events.
- Update existing source-regression tests that currently expect `buildAddSoulToCollectionTx` in the single-soul bind path.

Browser/recovery regression:

- Add this to `tests/new-web/collection-fast-path-regressions.test.ts` using the repo's existing Vitest/jsdom-style regression pattern: simulate the sliver upload window, refresh the recovery state, and assert the UI path asks the user to reselect files with no duplicate register call. This runbook uses the existing web test stack and does not add a new browser-runner dependency.

Bench (required, results captured in `docs/benchmarks/`):

- Build PTB2 fast-path bytes for `N ∈ {1, 3, 6, 12, 20}` against current mainnet package, run `dryRunTransactionBlock`, record bytes and gas. Use the data to confirm the `BYTES_CAP=96000` and `GAS_CAP_MIST=5_000_000_000` defaults; tune if real numbers indicate otherwise. The bench script lives at `scripts/bench-fast-path.ts`.

Required verification commands:

```bash
sui move build --path move/soulidity
sui move test --path move/soulidity
npm test
npm run typecheck
npm --prefix web run lint
npm run build:web:production-env
```

### 7. Release pipeline (testnet first → mainnet)

The release runs in two ordered stages. Testnet smoke must pass with the same package source as mainnet (no per-network conditional code). Mainnet only republishes after testnet is fully green on every workflow in the acceptance matrix.

#### 7a. Testnet stage (gates mainnet)

**Why testnet first:** Walrus testnet uses testnet WAL, which is free — `walrus get-wal` exchanges testnet SUI (from the Sui faucet) for testnet WAL on the Walrus exchange contract. So we can run the entire publish + buy + access loop end-to-end at zero real-token cost, and only flip to mainnet after the same matrix passes there.

Official Walrus docs currently describe exchanging testnet SUI for testnet WAL with `walrus get-wal --context testnet` (https://docs.wal.app/docs/usage/started). Stage 7a is mandatory. If the testnet exchange or faucet is unavailable, the release is blocked until the operator funds testnet WAL through the documented testnet path; do not bypass testnet smoke.

Required preflight (testnet):

```bash
# 1. Sanity: no live testnet state worth preserving (or accept overwrite)
NEXT_PUBLIC_SUI_NETWORK=testnet tsx scripts/precheck-live-soulidity-collections.ts

# 2. Faucet + WAL exchange (per smoke wallet)
sui client switch --env testnet
sui client faucet                              # Sui testnet SUI
walrus get-wal --context testnet --amount 5000000000
sui client balance                             # must show non-zero testnet WAL and no mainnet token movement
```

Reset mirror to a clean state (testnet only — never run on mainnet without sign-off):

```bash
NEXT_PUBLIC_SUI_NETWORK=testnet tsx scripts/reset-soulidity-mirror.ts --apply
```

Publish to testnet:

```bash
NEXT_PUBLIC_SUI_NETWORK=testnet npm run publish:soulidity
```

(`--mainnet-e2e` belongs to the mainnet stage and is not needed here; `runMainnetTsSdkFlow` accepts `network='testnet'` directly. Confirm `web/lib/soulidity/deployment-manifest.json` `testnet` block updates to the new package id and `move/soulidity/Published.toml` gets a fresh `[published.testnet]`.)

Add a new **smoke harness** at `scripts/smoke-soulidity.ts` (parameterized on `NEXT_PUBLIC_SUI_NETWORK`, used by both stage 7a and stage 7b — single harness, two networks):

- Loads smoke wallets from `.env.soulidity-smoke` (`SMOKE_PUBLISHER_KEY`, `SMOKE_BUYER_KEY`, `SMOKE_AGENT_KEY`); for testnet, the keys correspond to wallets the operator pre-funded via `sui client faucet` + `walrus get-wal`. For mainnet, the operator pre-funds with real SUI/USDC/WAL.
- Runs each row of the acceptance matrix as an automated PTB build → dry-run → sign → mirror sync → assertion. No human clicks.
- Asserts on **exact wallet signature count per workflow** (the spec the runbook is based on); fails fast if a workflow signs more than the matrix says.
- Logs PTB byte size + dry-run gas for every row, feeds the same numbers as `scripts/bench-fast-path.ts` so the bench data is captured for free during smoke.
- Exit non-zero on any signature-count mismatch, dry-run failure, or mirror divergence.
- Operator templates committed in repo so the matrix is auditable from the commit alone (not only from CI secrets):
  - `.env.soulidity-smoke.example` — wallet/auth/scenario env shape with funding requirements per network.
  - `scripts/scenarios/soulidity-smoke-matrix.example.json` — the 11 rows below as a JSON skeleton (name + expectedSignatures + step labels + signer + mirror routes); operator fills `transactionBase64` placeholders by building each PTB locally with the SDK builders in `web/lib/soulidity/tx/`. CI passes the populated JSON via `SOULIDITY_SMOKE_SCENARIO_JSON` repository secret.
- Add `.github/workflows/soulidity-fast-path-smoke.yml` in the implementation commit. It runs unit/type/build gates on PRs touching `move/soulidity/**`, `web/lib/soulidity/tx/**`, `web/lib/upload/**`, or `web/lib/hooks/use-{publish,collection-publish,assets}.ts`, and exposes a required `workflow_dispatch` job for `NEXT_PUBLIC_SUI_NETWORK=testnet` smoke using repository secrets for `.env.soulidity-smoke`. The mainnet stage cannot start until this testnet workflow has a green run for the exact commit being published.

Required testnet smoke matrix (must all pass before mainnet stage starts):

- Empty collection: exactly 2 wallet signatures, collection image resolves after certify, collection sync succeeds.
- Empty collection + collection-right listing: exactly 2 wallet signatures, listing sync succeeds.
- 3-soul collection: exactly 2 wallet signatures, all souls mint, bind, and mirror with the PTB2 digest.
- Single soul + existing collection bind: exactly 2 wallet signatures, bind sync uses the mint digest.
- Single soul + listing: exactly 2 wallet signatures, listing sync uses the mint digest.
- Single soul + bind + listing: exactly 2 wallet signatures, all mirror calls use the mint digest.
- First skills root + 3 versions: exactly 2 wallet signatures.
- First assets root + 3 sprite versions: exactly 2 wallet signatures.
- 12-soul collection: dry-run route is recorded; either fast path signs 2 times, or chunked fallback signs PTB1 plus chunks with the recorded reason in telemetry.
- Buy flow against a published soul: buyer kiosk receives the Soul, fees split correctly, all grants invalidated by ownership-epoch bump (no extra runbook signature requirement, but exercised in the same matrix to catch knock-on regressions).
- Cap handoff dry-run on testnet: `--resume-cap-transfer-from-manifest --transfer-caps-to=<testnet-multisig>` succeeds end-to-end so the same flow on mainnet is rehearsed code, not first-time code.

Stage 7a passes only when every row above runs green twice in a row (once after a clean publish, once after a `reset-soulidity-mirror.ts` mid-flight to confirm recovery is symmetric).

#### 7b. Mainnet stage

Required preflight (mainnet):

```bash
NEXT_PUBLIC_SUI_NETWORK=mainnet tsx scripts/precheck-live-soulidity-collections.ts
```

If the script reports live state that must remain available under the old package, stop before publish and get an explicit production data decision. If the state is disposable test data, reset the mirror with the existing reset script before switching the manifest.

Mainnet publish-only step (cap stays with deployer until smoke passes):

```bash
NEXT_PUBLIC_SUI_NETWORK=mainnet npm run publish:soulidity -- \
  --mainnet-e2e
```

Required mainnet smoke before Cap handoff — the same matrix as 7a, executed against the new mainnet package via the same `scripts/smoke-soulidity.ts` harness with `NEXT_PUBLIC_SUI_NETWORK=mainnet`:

- Empty collection: exactly 2 wallet signatures, collection image resolves after certify, collection sync succeeds.
- Empty collection + collection-right listing: exactly 2 wallet signatures, listing sync succeeds.
- 3-soul collection: exactly 2 wallet signatures, all souls mint, bind, and mirror with the PTB2 digest.
- Single soul + existing collection bind: exactly 2 wallet signatures, bind sync uses the mint digest.
- Single soul + listing: exactly 2 wallet signatures, listing sync uses the mint digest.
- Single soul + bind + listing: exactly 2 wallet signatures, all mirror calls use the mint digest.
- First skills root + 3 versions: exactly 2 wallet signatures.
- First assets root + 3 sprite versions: exactly 2 wallet signatures.
- 12-soul collection: dry-run route is recorded; either fast path signs 2 times or chunked fallback signs PTB1 plus chunks with telemetry explaining the fallback.

Cap handoff after smoke:

```bash
NEXT_PUBLIC_SUI_NETWORK=mainnet npm run publish:soulidity -- \
  --resume-cap-transfer-from-manifest \
  --transfer-caps-to=<multisig>
```

Post-handoff checks:

- `web/lib/soulidity/deployment-manifest.json` mainnet entry has the new package and multisig owner.
- `move/soulidity/Published.toml` has the new `[published.mainnet]` package and upgrade cap.
- `MarketUpgradeState.tracked_upgrade_cap_id` points to the current upgrade cap when tracking is enabled.
- Web production build reads the manifest entry, not parallel public env IDs.

### 8. Rollback

Rollback before mainnet Cap handoff (testnet stage already passed):

```bash
git checkout HEAD~1 -- web/lib/soulidity/deployment-manifest.json move/soulidity/Published.toml
npm run build:web:production-env
```

Rollback after mainnet Cap handoff:

- Restore the previous manifest and Published.toml entries from git.
- Redeploy web.
- Use multisig governance for any subsequent package operation; do not use the deployer key after handoff.

The newly published package remains on-chain. Web rollback is a manifest rollback; it does not delete chain objects.

If testnet stage 7a fails, the rollback is local: revert the working tree (`git restore .`), keep the previous mainnet manifest unchanged, and do not enter stage 7b. No mainnet artifact is produced.

## Review Findings Folded Into This Runbook

- The previous draft still had split-off UI and batch mirror work. This runbook moves every user-visible workflow and mirror call into the required path.
- The previous draft treated current Walrus batch helper as if register could be composed by callers. It cannot; the helper split is required before PTB1 can combine register and collection creation.
- The previous draft included invalid unshared-object tests. Finalization is now enforced through positive Move tests and TS command-sequence assertions.
- The previous draft mixed direct publish+Cap transfer with smoke. The required order is publish-only, smoke, then Cap handoff.
- The previous draft used one field name for recovery in one section and another in tests. v12 now uses `fastPathPtb2Digest` consistently.
- (eng review) Baseline declaration added: this runbook applies on top of `a7d107b` plus the current uncommitted groundwork diff, landed as one commit before ABI work begins.
- (eng review) `buildCreateCollectionWithSoulsTx` renamed to `buildCollectionFastPathPtb2Tx` so the name reflects “PTB2 of an existing fast path,” not a collection-creation function. `buildCreateCollectionPrimitiveTxPart` renamed to `appendCreateCollectionMoveCalls` to match the existing `appendMintNativeMoveCall` convention.
- (eng review) PTB2 fast path now defines explicit dry-run via `suiClient.dryRunTransactionBlock`, configurable byte/gas caps with defaults (`BYTES=96000`, `GAS_MIST=5_000_000_000`), and a hard fallback to chunked after one fast-path failure (`fastPathAttempt` in recovery).
- (eng review) Mirror RPC consolidated through a new `/api/souls/publish/batch` route so a 12-soul fast path is one mirror RPC, not 12.
- (eng review) Recovery v12 collapses `collectionRightListingDigest` + `collectionRightListingPriceAtomic` into one `collectionRightListing` field; adds `fastPathAttempt`.
- (eng review) Design Rules document old-package backwards compatibility and the 60-day post-release ABI freeze.
- (eng review) Tests expanded: walrus-batch helper split unit tests, fast-path failure routing tests, v11 → v12 migration regression, single-sigAndExecute regression in `use-publish.ts`, repo-native browser/recovery regression, and required bench output at `scripts/bench-fast-path.ts` + `docs/benchmarks/`.
- (codex review) Cover certification gap closed: empty collections now have an explicit cover-cert-only second signature, fast PTB2 certifies cover + soul blobs, and chunked fallback certifies cover exactly once in the first unsigned mint chunk.
- (codex review) Same-digest listing mirror gap closed: soul and collection listing routes must select listing events by route object ID, not by first event in the transaction.
- (codex review) Release safety tightened: testnet stage is mandatory, official testnet WAL acquisition is verified before smoke, testnet cannot be skipped, and the repo must add a concrete testnet smoke workflow.
- (codex review) Verification commands now run from the repo root and do not rely on shell cwd side effects.

## Final Plan Review Closure

**UNRESOLVED:** 0 — all findings above are required implementation work in this runbook.

**VERDICT:** CLEARED TO IMPLEMENT AFTER THE GROUNDWORK COMMIT. The runbook contains no parked work and no separate review bucket. Shipping requires every Required Implementation section, test suite, benchmark artifact, testnet stage, mainnet smoke, and post-handoff check in this runbook to pass for the same commit.
