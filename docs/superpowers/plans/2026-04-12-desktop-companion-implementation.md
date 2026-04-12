# Desktop Companion — Full Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 8 modules of the Desktop Companion spec in one pass: Move tests, missing API routes, hook adapters, status protocol, metadata types, Electron shell, sprite renderer, agent wallet, and LLM config.

**Architecture:** The spec covers 8 modules. Move contracts (assets.move, content_access.move) and most API routes already exist. This plan fills the remaining gaps: Move protocol tests, 2 missing API routes (asset append/delete), event extraction for asset deletion, hook adapter scripts, Electron Desktop-Claw fork with status watcher + sprite renderer + agent wallet + overlay window, and metadata/LLM config types.

**Tech Stack:** Move (Sui), TypeScript, Vitest, Next.js API routes, Electron, electron-vite, Canvas API, Node.js fs.watch, @mysten/sui, keytar

**Spec:** `docs/superpowers/specs/2026-04-10-desktop-companion-design.md`

---

## Pre-existing (verified, no work needed)

These are confirmed implemented and passing — do NOT re-implement:

- **Move contracts**: `assets.move`, `content_access.move`, `skills.move`, `seal_policy.move`, `grant.move`, `soul.move` — all complete with seal functions
- **Prisma schema**: `SoulAssetVersionRecord`, `ContentAccessRecord` — complete
- **Mirror functions**: `upsert-asset.ts`, `upsert-content-access.ts` — complete
- **Event extraction**: `extractAssetVersionAppendedEvent`, `tryExtractAssetVersionAppendedEvent`, `tryExtractContentAccessListCreatedEvent` — complete
- **TX builders**: `content-access.ts`, `publish.ts` (handles assets) — complete
- **API routes**: GET assets, GET access-list, POST access-list/purchase, POST access-list/add, POST access-list/revoke, human + agent asset access — complete
- **Seal crypto**: `generateAssetDocumentIdForVersion` — complete

---

## Task 1: Move protocol tests — SoulAssets module

**Files:**
- Modify: `move/soulidity/sources/protocol_tests.move`

- [ ] **Step 1: Add asset_document_id helper function**

Add after the existing `skill_document_id` helper (around line 185):

```move
fun default_asset_name(): std::string::String {
    std::string::utf8(b"persona-sprite")
}

fun asset_document_id(assets_id: ID, asset_name: std::string::String, version_index: u64): vector<u8> {
    let mut id = b"soul-asset:".to_vec();
    id.push_back(1u8); // DOCUMENT_ID_VERSION
    id.append(assets_id.to_bytes());

    let name_bytes = asset_name.into_bytes();
    id.append(name_bytes);
    id.push_back(0u8); // null separator

    append_u64_be_bytes(&mut id, version_index);

    // 16 bytes nonce
    let mut i = 0;
    while (i < 16) {
        id.push_back(0xAA);
        i = i + 1;
    };
    id
}
```

- [ ] **Step 2: Add mint helper that creates Soul with SoulAssets**

Add after `mint_native_in_personal_kiosk_no_skills`:

```move
fun mint_native_in_personal_kiosk_with_assets(
    scenario: &mut ts::Scenario,
    creator: address,
    kiosk_id: ID,
    blob: walrus::blob::Blob,
    founding_blob: walrus::blob::Blob,
    asset_blob: walrus::blob::Blob,
    asset_name: std::string::String,
    asset_type: u8,
    is_public: bool,
): (ID, ID, ID, ID) {
    scenario.next_tx(creator);
    {
        let market_config = scenario.take_shared<market::MarketConfig>();
        let mut kiosk = scenario.take_shared_by_id<sui::kiosk::Kiosk>(kiosk_id);
        let kiosk_cap = scenario.take_from_sender<sui::kiosk::KioskOwnerCap>();
        let clock = scenario.take_shared<sui::clock::Clock>();

        let (soul_id, state_id, memory_id, assets_id) = market::mint_native_in_personal_kiosk(
            &market_config,
            std::string::utf8(b"Test Soul"),
            std::string::utf8(b"A test soul with assets"),
            std::string::utf8(b"https://example.com/image.png"),
            std::option::none(),
            blob,
            500,
            founding_blob,
            std::option::none(),
            std::option::some(asset_name),
            std::option::some(is_public),
            std::option::some(asset_type),
            std::option::some(asset_blob),
            &mut kiosk,
            &kiosk_cap,
            &clock,
            scenario.ctx(),
        );

        ts::return_shared(market_config);
        ts::return_shared(kiosk);
        scenario.return_to_sender(kiosk_cap);
        ts::return_shared(clock);

        (soul_id, state_id, memory_id, assets_id)
    }
}
```

> **Note:** The exact `market::mint_native_in_personal_kiosk` signature must match what the market module exports. Read `market.move` to verify parameter order and optional asset params before implementing. Adjust the helper accordingly.

- [ ] **Step 3: Run Move tests to verify helpers compile**

Run: `sui move test --path move/soulidity 2>&1 | tail -20`
Expected: All existing 32 tests PASS, no new test failures.

- [ ] **Step 4: Write test — asset version append by owner and seal approval**

```move
#[test]
fun asset_version_append_and_seal_approval_by_owner() {
    let admin = @0xAD;
    let creator = @0xC1;
    let mut scenario = ts::begin(admin);

    init_protocol_for_testing(&mut scenario, admin);
    let creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint blobs
    let (soul_blob, founding_blob, asset_blob, extra_blob) = {
        scenario.next_tx(admin);
        let root = register_test_blob_with_root(&mut scenario, admin);
        let mut blobs = mint_test_blobs_to_recipients(&mut scenario, admin, root, vector[creator, creator, creator, creator]);
        let b4 = blobs.pop_back();
        let b3 = blobs.pop_back();
        let b2 = blobs.pop_back();
        let b1 = blobs.pop_back();
        blobs.destroy_empty();
        (b1, b2, b3, b4)
    };

    // Mint soul with initial asset
    let (soul_id, state_id, _memory_id, assets_id) = mint_native_in_personal_kiosk_with_assets(
        &mut scenario, creator, creator_kiosk_id,
        soul_blob, founding_blob, asset_blob,
        default_asset_name(), 0, false,
    );

    // Owner appends second version
    scenario.next_tx(creator);
    {
        let mut assets_obj = scenario.take_shared_by_id<assets::SoulAssets>(assets_id);
        let state = scenario.take_shared_by_id<soul::SoulState>(state_id);
        let clock = scenario.take_shared<sui::clock::Clock>();

        let version_index = assets::append_version_as_owner(
            &mut assets_obj, &state,
            std::string::utf8(b"persona-hires"),
            false, 0, extra_blob, &clock, scenario.ctx(),
        );
        assert!(version_index == 0); // first version under "persona-hires"

        ts::return_shared(assets_obj);
        ts::return_shared(state);
        ts::return_shared(clock);
    };

    // Owner seal approval for initial asset
    scenario.next_tx(creator);
    {
        let assets_obj = scenario.take_shared_by_id<assets::SoulAssets>(assets_id);
        let state = scenario.take_shared_by_id<soul::SoulState>(state_id);
        let doc_id = asset_document_id(assets_id, default_asset_name(), 0);

        assets::seal_approve_asset_read_owner(doc_id, &state, &assets_obj, default_asset_name(), 0, scenario.ctx());

        ts::return_shared(assets_obj);
        ts::return_shared(state);
    };

    scenario.end();
}
```

- [ ] **Step 5: Write test — granted agent can append + seal approve asset**

```move
#[test]
fun granted_agent_can_append_and_seal_approve_asset() {
    let admin = @0xAD;
    let creator = @0xC1;
    let agent = @0xA1;
    let mut scenario = ts::begin(admin);

    init_protocol_for_testing(&mut scenario, admin);
    let creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint blobs — one for soul, one for founding memory, one for initial asset, one for agent append
    let (soul_blob, founding_blob, asset_blob, agent_blob) = {
        scenario.next_tx(admin);
        let root = register_test_blob_with_root(&mut scenario, admin);
        let mut blobs = mint_test_blobs_to_recipients(&mut scenario, admin, root, vector[creator, creator, creator, agent]);
        let b4 = blobs.pop_back();
        let b3 = blobs.pop_back();
        let b2 = blobs.pop_back();
        let b1 = blobs.pop_back();
        blobs.destroy_empty();
        (b1, b2, b3, b4)
    };

    let (soul_id, state_id, _memory_id, assets_id) = mint_native_in_personal_kiosk_with_assets(
        &mut scenario, creator, creator_kiosk_id,
        soul_blob, founding_blob, asset_blob,
        default_asset_name(), 0, false,
    );

    // Issue grant with SCOPE_ASSETS (8) to agent
    let grant_id = issue_default_grant(&mut scenario, creator, state_id, agent, 8);

    // Agent appends asset version
    scenario.next_tx(agent);
    {
        let mut assets_obj = scenario.take_shared_by_id<assets::SoulAssets>(assets_id);
        let state = scenario.take_shared_by_id<soul::SoulState>(state_id);
        let soul_grant = scenario.take_from_sender<grant::SoulGrant>();
        let clock = scenario.take_shared<sui::clock::Clock>();

        let vi = assets::append_version_as_granted_agent(
            &mut assets_obj, &state, &soul_grant,
            default_asset_name(), false, 0, agent_blob, &clock, scenario.ctx(),
        );
        assert!(vi == 1); // second version (0-indexed, initial was 0)

        ts::return_shared(assets_obj);
        ts::return_shared(state);
        scenario.return_to_sender(soul_grant);
        ts::return_shared(clock);
    };

    // Agent seal approval
    scenario.next_tx(agent);
    {
        let assets_obj = scenario.take_shared_by_id<assets::SoulAssets>(assets_id);
        let state = scenario.take_shared_by_id<soul::SoulState>(state_id);
        let soul_grant = scenario.take_from_sender<grant::SoulGrant>();
        let clock = scenario.take_shared<sui::clock::Clock>();
        let doc_id = asset_document_id(assets_id, default_asset_name(), 1);

        assets::seal_approve_asset_read_granted_agent(
            doc_id, &state, &assets_obj, default_asset_name(), 1,
            &soul_grant, &clock, scenario.ctx(),
        );

        ts::return_shared(assets_obj);
        ts::return_shared(state);
        scenario.return_to_sender(soul_grant);
        ts::return_shared(clock);
    };

    scenario.end();
}
```

- [ ] **Step 6: Write test — owner can soft-delete asset version**

```move
#[test]
fun owner_can_soft_delete_asset_version() {
    let admin = @0xAD;
    let creator = @0xC1;
    let mut scenario = ts::begin(admin);

    init_protocol_for_testing(&mut scenario, admin);
    let creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    let (soul_blob, founding_blob, asset_blob) = {
        scenario.next_tx(admin);
        let root = register_test_blob_with_root(&mut scenario, admin);
        let mut blobs = mint_test_blobs_to_recipients(&mut scenario, admin, root, vector[creator, creator, creator]);
        let b3 = blobs.pop_back();
        let b2 = blobs.pop_back();
        let b1 = blobs.pop_back();
        blobs.destroy_empty();
        (b1, b2, b3)
    };

    let (_soul_id, state_id, _memory_id, assets_id) = mint_native_in_personal_kiosk_with_assets(
        &mut scenario, creator, creator_kiosk_id,
        soul_blob, founding_blob, asset_blob,
        default_asset_name(), 0, false,
    );

    // Owner deletes version 0
    scenario.next_tx(creator);
    {
        let mut assets_obj = scenario.take_shared_by_id<assets::SoulAssets>(assets_id);
        let state = scenario.take_shared_by_id<soul::SoulState>(state_id);

        assets::delete_version_as_owner(&mut assets_obj, &state, default_asset_name(), 0, scenario.ctx());
        assert!(assets::version_is_deleted(&assets_obj, default_asset_name(), 0));

        ts::return_shared(assets_obj);
        ts::return_shared(state);
    };

    scenario.end();
}
```

- [ ] **Step 7: Write test — seal approval fails on deleted asset**

```move
#[test]
#[expected_failure(abort_code = soulidity::assets::EAssetVersionDeleted)]
fun seal_approval_fails_on_deleted_asset() {
    let admin = @0xAD;
    let creator = @0xC1;
    let mut scenario = ts::begin(admin);

    init_protocol_for_testing(&mut scenario, admin);
    let creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    let (soul_blob, founding_blob, asset_blob) = {
        scenario.next_tx(admin);
        let root = register_test_blob_with_root(&mut scenario, admin);
        let mut blobs = mint_test_blobs_to_recipients(&mut scenario, admin, root, vector[creator, creator, creator]);
        let b3 = blobs.pop_back();
        let b2 = blobs.pop_back();
        let b1 = blobs.pop_back();
        blobs.destroy_empty();
        (b1, b2, b3)
    };

    let (_soul_id, state_id, _memory_id, assets_id) = mint_native_in_personal_kiosk_with_assets(
        &mut scenario, creator, creator_kiosk_id,
        soul_blob, founding_blob, asset_blob,
        default_asset_name(), 0, false,
    );

    // Delete then try seal
    scenario.next_tx(creator);
    {
        let mut assets_obj = scenario.take_shared_by_id<assets::SoulAssets>(assets_id);
        let state = scenario.take_shared_by_id<soul::SoulState>(state_id);
        assets::delete_version_as_owner(&mut assets_obj, &state, default_asset_name(), 0, scenario.ctx());
        ts::return_shared(assets_obj);
        ts::return_shared(state);
    };

    scenario.next_tx(creator);
    {
        let assets_obj = scenario.take_shared_by_id<assets::SoulAssets>(assets_id);
        let state = scenario.take_shared_by_id<soul::SoulState>(state_id);
        let doc_id = asset_document_id(assets_id, default_asset_name(), 0);
        // Should abort with EAssetVersionDeleted
        assets::seal_approve_asset_read_owner(doc_id, &state, &assets_obj, default_asset_name(), 0, scenario.ctx());
        ts::return_shared(assets_obj);
        ts::return_shared(state);
    };

    scenario.end();
}
```

- [ ] **Step 8: Run Move tests**

Run: `sui move test --path move/soulidity 2>&1 | tail -20`
Expected: All tests PASS including 4 new asset tests.

- [ ] **Step 9: Commit**

```bash
git add move/soulidity/sources/protocol_tests.move
git commit -m "test(move): add SoulAssets protocol tests — append, seal, delete, grant agent"
```

---

## Task 2: Move protocol tests — ContentAccessList module

**Files:**
- Modify: `move/soulidity/sources/protocol_tests.move`

- [ ] **Step 1: Write test — add_access and has_access**

```move
#[test]
fun content_access_add_and_check() {
    let admin = @0xAD;
    let creator = @0xC1;
    let buyer = @0xB1;
    let mut scenario = ts::begin(admin);

    init_protocol_for_testing(&mut scenario, admin);
    let creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    let (soul_blob, founding_blob) = {
        scenario.next_tx(admin);
        let root = register_test_blob_with_root(&mut scenario, admin);
        let mut blobs = mint_test_blobs_to_recipients(&mut scenario, admin, root, vector[creator, creator]);
        let b2 = blobs.pop_back();
        let b1 = blobs.pop_back();
        blobs.destroy_empty();
        (b1, b2)
    };

    let (soul_id, state_id, _memory_id) = mint_native_in_personal_kiosk_no_skills(
        &mut scenario, creator, creator_kiosk_id, soul_blob, founding_blob,
    );

    // Create access list (via market mint with access list — or manually)
    // Note: ContentAccessList creation goes through market::mint_native_in_personal_kiosk
    // For this test, check if market module creates it. If not, use a test-only create helper.
    // The actual approach depends on market.move's exported functions.
    // Adjust this test based on how ContentAccessList is created in the protocol.

    scenario.end();
}
```

> **Implementation note:** Before writing content_access tests, read `market.move` to understand how `ContentAccessList` is created during the mint flow. The test helpers need to produce a Soul with an access list. Adjust the mint helper or add a dedicated test-only creation path.

- [ ] **Step 2: Write test — seal_approve_skill_allowlisted and seal_approve_asset_allowlisted**

These tests verify that an address on the ContentAccessList with the correct scope can seal-approve skill and asset reads. The test structure follows the pattern from Task 1 but uses `content_access::seal_approve_skill_allowlisted` and `content_access::seal_approve_asset_allowlisted`.

- [ ] **Step 3: Write test — revoke_access removes entry**

Test that `content_access::revoke_access` called by creator removes the entry and `has_access` returns false.

- [ ] **Step 4: Write test — set_content_price updates price**

Test that `content_access::set_content_price` emits `ContentAccessPriceUpdated` and the new price is readable.

- [ ] **Step 5: Run Move tests**

Run: `sui move test --path move/soulidity 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add move/soulidity/sources/protocol_tests.move
git commit -m "test(move): add ContentAccessList protocol tests — add, revoke, set_price, seal"
```

---

## Task 3: Add `extractAssetVersionDeletedEvent` to events.ts

**Files:**
- Modify: `web/lib/soulidity/events.ts`
- Create: `tests/new-web/soulidity-events-asset-delete.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/new-web/soulidity-events-asset-delete.test.ts
import { describe, it, expect } from 'vitest'

const PACKAGE_ID = '0x0000000000000000000000000000000000000000000000000000000000000123'
const ASSETS_ID = '0x00000000000000000000000000000000000000000000000000000000000000aa'
const SOUL_ID = '0x00000000000000000000000000000000000000000000000000000000000000bb'
const DELETED_BY = '0x00000000000000000000000000000000000000000000000000000000000000cc'

function makeTx(events: Array<{ type: string; parsedJson: Record<string, unknown> }>) {
  return { events } as never
}

describe('extractAssetVersionDeletedEvent', () => {
  it('extracts asset deletion event from transaction', async () => {
    const { extractAssetVersionDeletedEvent } = await import('../../web/lib/soulidity/events.ts')

    const tx = makeTx([{
      type: `${PACKAGE_ID}::assets::AssetVersionDeleted`,
      parsedJson: {
        assets_id: ASSETS_ID,
        soul_id: SOUL_ID,
        asset_name: 'persona-sprite',
        version_index: '0',
        deleted_by: DELETED_BY,
      },
    }])

    const result = extractAssetVersionDeletedEvent(tx, PACKAGE_ID)
    expect(result).toEqual({
      assetsId: ASSETS_ID,
      soulId: SOUL_ID,
      assetName: 'persona-sprite',
      versionIndex: 0,
      deletedBy: DELETED_BY,
    })
  })

  it('throws when event is missing', async () => {
    const { extractAssetVersionDeletedEvent } = await import('../../web/lib/soulidity/events.ts')
    const tx = makeTx([])
    expect(() => extractAssetVersionDeletedEvent(tx, PACKAGE_ID)).toThrow('AssetVersionDeleted event is missing')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/new-web/soulidity-events-asset-delete.test.ts`
Expected: FAIL — `extractAssetVersionDeletedEvent` is not exported.

- [ ] **Step 3: Implement extractAssetVersionDeletedEvent**

Add to `web/lib/soulidity/events.ts` after the existing `extractAssetVersionAppendedEvent` / `tryExtractAssetVersionAppendedEvent` (around line 453):

```typescript
export function extractAssetVersionDeletedEvent(transaction: TransactionLike, packageId: string, trustedPackageIds?: string[]) {
  const event = extractTypedEvent(transaction, `${packageId}::assets::AssetVersionDeleted`, trustedPackageIds)
  if (!event) {
    throw new OnChainVerificationError('AssetVersionDeleted event is missing from the transaction')
  }
  return {
    assetsId: readObjectId(event.assets_id, 'AssetVersionDeleted assets_id'),
    soulId: readObjectId(event.soul_id, 'AssetVersionDeleted soul_id'),
    assetName: readString(event.asset_name, 'AssetVersionDeleted asset_name'),
    versionIndex: readNumber(event.version_index, 'AssetVersionDeleted version_index'),
    deletedBy: readObjectId(event.deleted_by, 'AssetVersionDeleted deleted_by'),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/new-web/soulidity-events-asset-delete.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/soulidity/events.ts tests/new-web/soulidity-events-asset-delete.test.ts
git commit -m "feat(soulidity): add extractAssetVersionDeletedEvent for post-TX asset deletion sync"
```

---

## Task 4: Asset append POST route

**Files:**
- Modify: `web/app/api/souls/[id]/assets/route.ts`
- Create: `tests/new-web/soul-asset-append-route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/new-web/soul-asset-append-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockedIdentity = { identity: { memberId: 'member-1' }, walletAddresses: ['0xwallet1'] }
const mockedSoul = {
  onChainId: '0xsoul1',
  stateOnChainId: '0xstate1',
  memoryOnChainId: '0xmemory1',
  assetsOnChainId: '0xassets1',
  category: null,
  tags: [],
  previewImages: [],
  readme: null,
  sealSidecar: null,
  creatorMemberId: 'member-1',
  currentOwnerMemberId: 'member-1',
  listingObjectOnChainId: null,
  listedPriceAtomic: null,
  listingStatus: 'held',
}

const {
  mockRequireHumanWalletIdentity,
  mockTakeRateLimitToken,
  mockFindSoulAssetDetailByRouteId,
  mockGetStoredSoulidityTxSync,
  mockWaitForTransactionBestEffort,
  mockGetSuccessfulTransactionBlock,
  mockReadTransactionSender,
  mockExtractAssetVersionAppendedEvent,
  mockSyncSoulProjectionFromChain,
  mockBuildSyncSealSidecars,
  mockResolveWalrusBlobId,
  mockUpsertAssetVersionProjection,
  mockStoreSoulidityTxSync,
} = vi.hoisted(() => ({
  mockRequireHumanWalletIdentity: vi.fn(),
  mockTakeRateLimitToken: vi.fn(),
  mockFindSoulAssetDetailByRouteId: vi.fn(),
  mockGetStoredSoulidityTxSync: vi.fn(),
  mockWaitForTransactionBestEffort: vi.fn(),
  mockGetSuccessfulTransactionBlock: vi.fn(),
  mockReadTransactionSender: vi.fn(),
  mockExtractAssetVersionAppendedEvent: vi.fn(),
  mockSyncSoulProjectionFromChain: vi.fn(),
  mockBuildSyncSealSidecars: vi.fn(),
  mockResolveWalrusBlobId: vi.fn(),
  mockUpsertAssetVersionProjection: vi.fn(),
  mockStoreSoulidityTxSync: vi.fn(),
}))

vi.mock('@/lib/soulidity/server', () => ({
  requireHumanWalletIdentity: mockRequireHumanWalletIdentity,
  assertTransactionSender: vi.fn(() => null),
}))
vi.mock('@web/lib/rate-limit', () => ({ takeRateLimitToken: mockTakeRateLimitToken }))
vi.mock('@/lib/soulidity/repository', () => ({ findSoulAssetDetailByRouteId: mockFindSoulAssetDetailByRouteId }))
vi.mock('@/lib/soulidity/mirror/tx-sync', () => ({
  getStoredSoulidityTxSync: mockGetStoredSoulidityTxSync,
  storeSoulidityTxSync: mockStoreSoulidityTxSync,
}))
vi.mock('@/lib/soulidity/queries', () => ({
  getSuccessfulTransactionBlock: mockGetSuccessfulTransactionBlock,
  readTransactionSender: mockReadTransactionSender,
  waitForTransactionBestEffort: mockWaitForTransactionBestEffort,
  resolveWalrusBlobId: mockResolveWalrusBlobId,
}))
vi.mock('@/lib/soulidity/events', () => ({
  extractAssetVersionAppendedEvent: mockExtractAssetVersionAppendedEvent,
}))
vi.mock('@/lib/soulidity/mirror/sync-helpers', () => ({
  syncSoulProjectionFromChain: mockSyncSoulProjectionFromChain,
}))
vi.mock('@/lib/soulidity/mirror/build-seal-sidecars', () => ({
  buildSyncSealSidecars: mockBuildSyncSealSidecars,
  SealSidecarSyncConfigError: class extends Error {},
}))
vi.mock('@/lib/soulidity/mirror/upsert-asset', () => ({
  upsertAssetVersionProjection: mockUpsertAssetVersionProjection,
}))
vi.mock('@/lib/soulidity/env', () => ({
  getRequiredSoulidityEnv: vi.fn(() => '0xpkg'),
}))
vi.mock('@/lib/soulidity/request', () => ({
  parseRequiredTxDigest: vi.fn((v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null)),
}))

describe('POST /api/souls/[id]/assets (append)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRequireHumanWalletIdentity.mockResolvedValue(mockedIdentity)
    mockTakeRateLimitToken.mockResolvedValue({ limited: false })
    mockFindSoulAssetDetailByRouteId.mockResolvedValue(mockedSoul)
    mockGetStoredSoulidityTxSync.mockResolvedValue(null)
  })

  it('mirrors an asset version append transaction', async () => {
    mockWaitForTransactionBestEffort.mockResolvedValue(undefined)
    mockGetSuccessfulTransactionBlock.mockResolvedValue({ events: [] })
    mockReadTransactionSender.mockReturnValue('0xwallet1')
    mockExtractAssetVersionAppendedEvent.mockReturnValue({
      assetsId: '0xassets1', soulId: '0xsoul1',
      assetName: 'persona-sprite', versionIndex: 0,
      visibility: 'private', assetType: 'sprite',
      createdAtMs: 1000, blobObjectId: '0xblob1',
    })
    mockSyncSoulProjectionFromChain.mockResolvedValue({ onChainId: '0xsoul1' })
    mockBuildSyncSealSidecars.mockResolvedValue({ assetsSidecar: { encrypted: true } })
    mockResolveWalrusBlobId.mockResolvedValue('blob-id-1')
    mockUpsertAssetVersionProjection.mockResolvedValue({
      assetName: 'persona-sprite', versionIndex: 0,
    })

    const { POST } = await import('../../web/app/api/souls/[id]/assets/route.ts')

    const request = new Request('http://localhost/api/souls/test-id/assets', {
      method: 'POST',
      body: JSON.stringify({ txDigest: 'tx123' }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-id' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.assetName).toBe('persona-sprite')
    expect(body.versionIndex).toBe(0)
    expect(mockStoreSoulidityTxSync).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/new-web/soul-asset-append-route.test.ts`
Expected: FAIL — POST handler is not exported from the route file.

- [ ] **Step 3: Implement POST handler in assets route.ts**

Add to `web/app/api/souls/[id]/assets/route.ts` — follow the identical pattern from `web/app/api/souls/[id]/skills/route.ts` POST handler, replacing:
- `extractSkillVersionAppendedEvent` → `extractAssetVersionAppendedEvent`
- `upsertSkillVersionProjection` → `upsertAssetVersionProjection`
- `rawSkillsEnvelope` → `rawAssetsEnvelope`
- `skillsSidecar` → `assetsSidecar`
- `skillBinding` → `assetBinding` (with `assetsObjectId`, `assetName`, `versionIndex`)
- Route key: `'assets:append'`

Add the required imports at the top.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/new-web/soul-asset-append-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/souls/[id]/assets/route.ts tests/new-web/soul-asset-append-route.test.ts
git commit -m "feat(api): add POST /api/souls/[id]/assets for asset version append"
```

---

## Task 5: Asset delete POST route

**Files:**
- Create: `web/app/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/delete/route.ts`
- Create: `tests/new-web/soul-asset-delete-route.test.ts`

- [ ] **Step 1: Write the failing test**

Follow the same mock pattern as Task 4. Test that POST with a valid txDigest extracts `AssetVersionDeleted` event and calls `markAssetVersionDeleted`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/new-web/soul-asset-delete-route.test.ts`
Expected: FAIL — route file doesn't exist.

- [ ] **Step 3: Implement delete route**

Create `web/app/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/delete/route.ts` following the exact pattern of `web/app/api/souls/[id]/skills/[skillName]/versions/[versionIndex]/delete/route.ts`, replacing:
- `extractSkillVersionDeletedEvent` → `extractAssetVersionDeletedEvent`
- `markSkillVersionDeletedFromChain` → inline call to `markAssetVersionDeleted` from `web/lib/soulidity/mirror/upsert-asset.ts`
- Route key: `'assets:delete'`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/new-web/soul-asset-delete-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/souls/[id]/assets/[assetName]/versions/[versionIndex]/delete/route.ts tests/new-web/soul-asset-delete-route.test.ts
git commit -m "feat(api): add POST /api/souls/[id]/assets/[assetName]/versions/[versionIndex]/delete"
```

---

## Task 6: Status protocol types

**Files:**
- Create: `desktop/packages/shared/src/types/cli-status.ts`
- Create: `tests/desktop/cli-status-types.test.ts`

> **Prerequisite:** Task 9 (Desktop-Claw fork) must be done first so `desktop/packages/shared/` exists. If running before Task 9, create these files at a temporary location and move them after the fork.

- [ ] **Step 1: Write the type validation test**

```typescript
// tests/desktop/cli-status-types.test.ts
import { describe, it, expect } from 'vitest'
import type { AgentStatusFile, AgentSession, CliAgentStatus } from '../../desktop/packages/shared/src/types/cli-status'
import { parseAgentStatusFile, deriveAggregateStatus } from '../../desktop/packages/shared/src/types/cli-status'

describe('cli-status types', () => {
  it('parseAgentStatusFile accepts valid file', () => {
    const input: AgentStatusFile = {
      version: 1,
      lastUpdated: Date.now(),
      sessions: {
        'session-1': {
          sessionId: 'session-1',
          clientType: 'claude-code',
          status: 'working',
          startedAt: Date.now() - 5000,
          lastUpdated: Date.now(),
        },
      },
    }
    const result = parseAgentStatusFile(JSON.stringify(input))
    expect(result).not.toBeNull()
    expect(result!.sessions['session-1'].status).toBe('working')
  })

  it('parseAgentStatusFile rejects invalid version', () => {
    const result = parseAgentStatusFile(JSON.stringify({ version: 99, lastUpdated: 0, sessions: {} }))
    expect(result).toBeNull()
  })

  it('parseAgentStatusFile returns null for malformed JSON', () => {
    expect(parseAgentStatusFile('{')).toBeNull()
    expect(parseAgentStatusFile('')).toBeNull()
  })

  it('deriveAggregateStatus picks most-recent non-ended session', () => {
    const file: AgentStatusFile = {
      version: 1,
      lastUpdated: Date.now(),
      sessions: {
        old: {
          sessionId: 'old',
          clientType: 'claude-code',
          status: 'completed',
          startedAt: 1000,
          lastUpdated: 2000,
          endedAt: 3000,
        },
        active: {
          sessionId: 'active',
          clientType: 'claude-code',
          status: 'working',
          startedAt: 4000,
          lastUpdated: 5000,
        },
      },
    }
    expect(deriveAggregateStatus(file)).toBe('working')
  })

  it('deriveAggregateStatus returns idle when all sessions ended', () => {
    const file: AgentStatusFile = {
      version: 1,
      lastUpdated: Date.now(),
      sessions: {
        done: {
          sessionId: 'done',
          clientType: 'claude-code',
          status: 'completed',
          startedAt: 1000,
          lastUpdated: 2000,
          endedAt: 3000,
        },
      },
    }
    expect(deriveAggregateStatus(file)).toBe('idle')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/desktop/cli-status-types.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement cli-status.ts**

```typescript
// desktop/packages/shared/src/types/cli-status.ts

export type CliAgentStatus =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'needs-attention'
  | 'completed'
  | 'error'

export interface AgentSession {
  sessionId: string
  clientType: 'claude-code' | 'codex' | 'custom'
  status: CliAgentStatus
  workingDirectory?: string
  sessionTitle?: string
  currentAction?: {
    tool?: string
    details?: string
    timestamp: number
  }
  needsAttention?: string
  startedAt: number
  lastUpdated: number
  endedAt?: number
}

export interface AgentStatusFile {
  version: 1
  lastUpdated: number
  sessions: Record<string, AgentSession>
}

const VALID_STATUSES = new Set<string>(['idle', 'thinking', 'working', 'needs-attention', 'completed', 'error'])
const VALID_CLIENT_TYPES = new Set<string>(['claude-code', 'codex', 'custom'])

export function parseAgentStatusFile(raw: string): AgentStatusFile | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1) return null
    if (typeof parsed.lastUpdated !== 'number') return null
    if (typeof parsed.sessions !== 'object' || parsed.sessions === null) return null

    for (const [key, session] of Object.entries(parsed.sessions)) {
      const s = session as Record<string, unknown>
      if (typeof s.sessionId !== 'string') return null
      if (!VALID_CLIENT_TYPES.has(s.clientType as string)) return null
      if (!VALID_STATUSES.has(s.status as string)) return null
      if (typeof s.startedAt !== 'number') return null
      if (typeof s.lastUpdated !== 'number') return null
    }

    return parsed as AgentStatusFile
  } catch {
    return null
  }
}

export function deriveAggregateStatus(file: AgentStatusFile): CliAgentStatus {
  let best: AgentSession | null = null
  for (const session of Object.values(file.sessions)) {
    if (session.endedAt != null) continue
    if (!best || session.lastUpdated > best.lastUpdated) {
      best = session
    }
  }
  return best?.status ?? 'idle'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/desktop/cli-status-types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/packages/shared/src/types/cli-status.ts tests/desktop/cli-status-types.test.ts
git commit -m "feat(desktop): add CLI status protocol types with parser and aggregator"
```

---

## Task 7: Claude Code hook adapter

**Files:**
- Create: `desktop/apps/desktop/resources/hooks/soulidity-claude-hook.js`
- Create: `tests/desktop/soulidity-claude-hook.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/desktop/soulidity-claude-hook.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// The hook is a standalone script. We test its core logic by extracting functions.
// Import the hook module (it exports processHookEvent for testing).
describe('soulidity-claude-hook', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soulidity-hook-test-'))
  })

  it('SessionStart creates idle session', async () => {
    const { processHookEvent } = await import(
      '../../desktop/apps/desktop/resources/hooks/soulidity-claude-hook.js'
    )
    const input = {
      event: 'SessionStart',
      session_id: 'sess-1',
      cwd: '/home/user/project',
    }
    const result = processHookEvent(input, tmpDir)
    expect(result.sessions['sess-1'].status).toBe('idle')
    expect(result.sessions['sess-1'].clientType).toBe('claude-code')
  })

  it('PreToolUse sets working + currentAction', async () => {
    const { processHookEvent } = await import(
      '../../desktop/apps/desktop/resources/hooks/soulidity-claude-hook.js'
    )
    // First create session
    processHookEvent({ event: 'SessionStart', session_id: 'sess-1' }, tmpDir)
    // Then tool use
    const result = processHookEvent({
      event: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'Edit',
      tool_input: { file_path: '/src/main.ts' },
    }, tmpDir)
    expect(result.sessions['sess-1'].status).toBe('working')
    expect(result.sessions['sess-1'].currentAction?.tool).toBe('Edit')
    expect(result.sessions['sess-1'].currentAction?.details).toContain('main.ts')
  })

  it('AskUserQuestion triggers needs-attention', async () => {
    const { processHookEvent } = await import(
      '../../desktop/apps/desktop/resources/hooks/soulidity-claude-hook.js'
    )
    processHookEvent({ event: 'SessionStart', session_id: 'sess-1' }, tmpDir)
    const result = processHookEvent({
      event: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'AskUserQuestion',
      tool_input: {},
    }, tmpDir)
    expect(result.sessions['sess-1'].status).toBe('needs-attention')
    expect(result.sessions['sess-1'].needsAttention).toBe('AskUserQuestion')
  })

  it('Stop sets completed', async () => {
    const { processHookEvent } = await import(
      '../../desktop/apps/desktop/resources/hooks/soulidity-claude-hook.js'
    )
    processHookEvent({ event: 'SessionStart', session_id: 'sess-1' }, tmpDir)
    const result = processHookEvent({ event: 'Stop', session_id: 'sess-1' }, tmpDir)
    expect(result.sessions['sess-1'].status).toBe('completed')
  })

  it('SessionEnd sets idle with endedAt', async () => {
    const { processHookEvent } = await import(
      '../../desktop/apps/desktop/resources/hooks/soulidity-claude-hook.js'
    )
    processHookEvent({ event: 'SessionStart', session_id: 'sess-1' }, tmpDir)
    const result = processHookEvent({ event: 'SessionEnd', session_id: 'sess-1' }, tmpDir)
    expect(result.sessions['sess-1'].status).toBe('idle')
    expect(result.sessions['sess-1'].endedAt).toBeDefined()
  })

  it('cleans up sessions older than 24h', async () => {
    const { processHookEvent } = await import(
      '../../desktop/apps/desktop/resources/hooks/soulidity-claude-hook.js'
    )
    // Create an old session
    const old = processHookEvent({ event: 'SessionStart', session_id: 'old-sess' }, tmpDir)
    old.sessions['old-sess'].lastUpdated = Date.now() - 25 * 60 * 60 * 1000
    // Write it
    fs.writeFileSync(path.join(tmpDir, 'agent-status.json'), JSON.stringify(old))
    // New event triggers cleanup
    const result = processHookEvent({ event: 'SessionStart', session_id: 'new-sess' }, tmpDir)
    expect(result.sessions['old-sess']).toBeUndefined()
    expect(result.sessions['new-sess']).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/desktop/soulidity-claude-hook.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the Claude Code hook**

```javascript
// desktop/apps/desktop/resources/hooks/soulidity-claude-hook.js
// Soulidity Claude Code hook adapter
// Zero dependencies — runs via node/bun, reads JSON from stdin, writes to ~/.soulidity/

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const SOULIDITY_DIR_DEFAULT = path.join(os.homedir(), '.soulidity')
const STATUS_FILE = 'agent-status.json'
const CLEANUP_THRESHOLD_MS = 24 * 60 * 60 * 1000

const ATTENTION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])

function extractToolDetails(toolName, toolInput) {
  if (!toolInput) return toolName
  if (toolInput.file_path) return `${toolName}: ${path.basename(toolInput.file_path)}`
  if (toolInput.command) return `${toolName}: ${toolInput.command.slice(0, 60)}`
  if (toolInput.pattern) return `${toolName}: ${toolInput.pattern}`
  return toolName
}

function readStatusFile(dir) {
  const filePath = path.join(dir, STATUS_FILE)
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed?.version === 1) return parsed
  } catch {}
  return { version: 1, lastUpdated: Date.now(), sessions: {} }
}

function writeStatusFile(dir, data) {
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, STATUS_FILE)
  const tmpPath = filePath + '.tmp.' + process.pid
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2))
  fs.renameSync(tmpPath, filePath)
}

function cleanupExpired(sessions) {
  const now = Date.now()
  const cleaned = {}
  for (const [id, session] of Object.entries(sessions)) {
    if (now - session.lastUpdated < CLEANUP_THRESHOLD_MS) {
      cleaned[id] = session
    }
  }
  return cleaned
}

function processHookEvent(input, dir) {
  if (!dir) dir = SOULIDITY_DIR_DEFAULT
  const data = readStatusFile(dir)
  const now = Date.now()
  const sessionId = input.session_id || 'unknown'

  // Ensure session exists
  if (!data.sessions[sessionId]) {
    data.sessions[sessionId] = {
      sessionId,
      clientType: 'claude-code',
      status: 'idle',
      startedAt: now,
      lastUpdated: now,
    }
  }

  const session = data.sessions[sessionId]
  session.lastUpdated = now

  if (input.cwd) session.workingDirectory = input.cwd

  switch (input.event) {
    case 'SessionStart':
      session.status = 'idle'
      session.startedAt = now
      delete session.endedAt
      delete session.currentAction
      delete session.needsAttention
      break
    case 'UserPromptSubmit':
      session.status = 'working'
      delete session.currentAction
      delete session.needsAttention
      break
    case 'PreToolUse': {
      const toolName = input.tool_name || ''
      if (ATTENTION_TOOLS.has(toolName)) {
        session.status = 'needs-attention'
        session.needsAttention = toolName
      } else {
        session.status = 'working'
        delete session.needsAttention
      }
      session.currentAction = {
        tool: toolName,
        details: extractToolDetails(toolName, input.tool_input),
        timestamp: now,
      }
      break
    }
    case 'PostToolUse':
      session.status = 'working'
      delete session.currentAction
      break
    case 'Stop':
      session.status = 'completed'
      delete session.currentAction
      delete session.needsAttention
      break
    case 'SessionEnd':
      session.status = 'idle'
      session.endedAt = now
      delete session.currentAction
      delete session.needsAttention
      break
  }

  data.sessions = cleanupExpired(data.sessions)
  data.lastUpdated = now

  writeStatusFile(dir, data)
  return data
}

// Main: read from stdin
if (require.main === module) {
  let input = ''
  process.stdin.setEncoding('utf-8')
  process.stdin.on('data', (chunk) => { input += chunk })
  process.stdin.on('end', () => {
    try {
      const parsed = JSON.parse(input)
      processHookEvent(parsed)
    } catch (err) {
      // Silently ignore parse errors — don't break the CLI
    }
  })
}

// Export for testing
if (typeof module !== 'undefined') {
  module.exports = { processHookEvent }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/desktop/soulidity-claude-hook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/apps/desktop/resources/hooks/soulidity-claude-hook.js tests/desktop/soulidity-claude-hook.test.ts
git commit -m "feat(desktop): add Claude Code hook adapter for CLI status protocol"
```

---

## Task 8: Codex hook adapter

**Files:**
- Create: `desktop/apps/desktop/resources/hooks/soulidity-codex-hook.js`
- Create: `tests/desktop/soulidity-codex-hook.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/desktop/soulidity-codex-hook.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

describe('soulidity-codex-hook', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soulidity-codex-test-'))
  })

  it('agent-turn-complete maps to completed', async () => {
    const { processCodexEvent } = await import(
      '../../desktop/apps/desktop/resources/hooks/soulidity-codex-hook.js'
    )
    const input = {
      type: 'agent-turn-complete',
      session_id: 'codex-1',
    }
    const result = processCodexEvent(input, tmpDir)
    expect(result.sessions['codex-1'].status).toBe('completed')
    expect(result.sessions['codex-1'].clientType).toBe('codex')
  })

  it('extracts session title from input-messages', async () => {
    const { processCodexEvent } = await import(
      '../../desktop/apps/desktop/resources/hooks/soulidity-codex-hook.js'
    )
    const input = {
      type: 'agent-turn-complete',
      session_id: 'codex-1',
      'input-messages': [
        { role: 'user', content: 'Fix the login bug' },
      ],
    }
    const result = processCodexEvent(input, tmpDir)
    expect(result.sessions['codex-1'].sessionTitle).toBe('Fix the login bug')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/desktop/soulidity-codex-hook.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the Codex hook**

```javascript
// desktop/apps/desktop/resources/hooks/soulidity-codex-hook.js
// Soulidity Codex hook adapter — maps agent-turn-complete to completed status
// Zero dependencies.

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const SOULIDITY_DIR_DEFAULT = path.join(os.homedir(), '.soulidity')
const STATUS_FILE = 'agent-status.json'

function readStatusFile(dir) {
  const filePath = path.join(dir, STATUS_FILE)
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed?.version === 1) return parsed
  } catch {}
  return { version: 1, lastUpdated: Date.now(), sessions: {} }
}

function writeStatusFile(dir, data) {
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, STATUS_FILE)
  const tmpPath = filePath + '.tmp.' + process.pid
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2))
  fs.renameSync(tmpPath, filePath)
}

function extractTitle(inputMessages) {
  if (!Array.isArray(inputMessages)) return undefined
  const first = inputMessages.find((m) => m.role === 'user')
  if (!first) return undefined
  const content = typeof first.content === 'string' ? first.content : ''
  return content.slice(0, 120) || undefined
}

function processCodexEvent(input, dir) {
  if (!dir) dir = SOULIDITY_DIR_DEFAULT
  const data = readStatusFile(dir)
  const now = Date.now()
  const sessionId = input.session_id || `codex-${now}`

  if (!data.sessions[sessionId]) {
    data.sessions[sessionId] = {
      sessionId,
      clientType: 'codex',
      status: 'idle',
      startedAt: now,
      lastUpdated: now,
    }
  }

  const session = data.sessions[sessionId]
  session.lastUpdated = now

  if (input.type === 'agent-turn-complete') {
    session.status = 'completed'
    delete session.currentAction
  }

  const title = extractTitle(input['input-messages'])
  if (title) session.sessionTitle = title

  data.lastUpdated = now
  writeStatusFile(dir, data)
  return data
}

// Main: read from argv (Codex passes JSON as argument) or stdin
if (require.main === module) {
  const arg = process.argv[2]
  if (arg) {
    try {
      processCodexEvent(JSON.parse(arg))
    } catch {}
  } else {
    let input = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk) => { input += chunk })
    process.stdin.on('end', () => {
      try {
        processCodexEvent(JSON.parse(input))
      } catch {}
    })
  }
}

if (typeof module !== 'undefined') {
  module.exports = { processCodexEvent }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/desktop/soulidity-codex-hook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/apps/desktop/resources/hooks/soulidity-codex-hook.js tests/desktop/soulidity-codex-hook.test.ts
git commit -m "feat(desktop): add Codex hook adapter for CLI status protocol"
```

---

## Task 9: SoulMetadata type definitions

**Files:**
- Create: `web/lib/soulidity/metadata.ts`
- Create: `tests/new-web/soulidity-metadata.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/new-web/soulidity-metadata.test.ts
import { describe, it, expect } from 'vitest'
import { parseSoulMetadata, type SoulMetadata } from '../../web/lib/soulidity/metadata'

describe('parseSoulMetadata', () => {
  it('parses valid sprite-sheet metadata', () => {
    const input: SoulMetadata = {
      version: 1,
      persona: {
        format: 'sprite-sheet',
        stateMap: {
          idle: 'idle',
          thinking: 'thinking',
          working: 'working',
          'needs-attention': 'alert',
          completed: 'done',
          error: 'error',
        },
        publicAssets: {
          type: 'sprite-sheet',
          sheetUrl: 'https://walrus.example/blob/abc',
          frameWidth: 64,
          frameHeight: 64,
          columns: 6,
          animations: {
            idle: { frames: [0, 1, 2, 3], fps: 8, loop: true },
          },
        },
      },
    }
    const result = parseSoulMetadata(JSON.stringify(input))
    expect(result).not.toBeNull()
    expect(result!.persona!.format).toBe('sprite-sheet')
    expect(result!.persona!.publicAssets!.frameWidth).toBe(64)
  })

  it('rejects invalid version', () => {
    expect(parseSoulMetadata(JSON.stringify({ version: 2 }))).toBeNull()
  })

  it('accepts metadata without persona (voice-only or minimal)', () => {
    const input = { version: 1 }
    const result = parseSoulMetadata(JSON.stringify(input))
    expect(result).not.toBeNull()
    expect(result!.persona).toBeUndefined()
  })

  it('returns null for malformed JSON', () => {
    expect(parseSoulMetadata('not json')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/new-web/soulidity-metadata.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement metadata.ts**

```typescript
// web/lib/soulidity/metadata.ts

import type { CliAgentStatus } from '../../desktop/packages/shared/src/types/cli-status'

export interface SpriteSheetAsset {
  type: 'sprite-sheet'
  sheetUrl: string
  frameWidth: number
  frameHeight: number
  columns: number
  animations: {
    [name: string]: {
      frames: number[]
      fps: number
      loop: boolean
    }
  }
}

export interface SoulMetadata {
  version: 1

  persona?: {
    format: 'sprite-sheet' | 'live2d'
    stateMap: Record<CliAgentStatus, string>
    publicAssets?: SpriteSheetAsset
    protectedAssets?: {
      assetName: string
      versionIndex: number
    }
  }

  voice?: {
    format: 'clips' | 'tts-profile'
    clips?: Record<string, string>
    ttsProfile?: {
      provider: string
      voiceId: string
      config?: Record<string, unknown>
    }
  }

  extra?: Record<string, unknown>
}

export function parseSoulMetadata(raw: string): SoulMetadata | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1) return null
    return parsed as SoulMetadata
  } catch {
    return null
  }
}
```

> **Note:** The import of `CliAgentStatus` may need adjustment depending on whether the desktop types are accessible from web. If not, duplicate the type locally or use a string union directly. The type definition is the same either way.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/new-web/soulidity-metadata.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/soulidity/metadata.ts tests/new-web/soulidity-metadata.test.ts
git commit -m "feat(soulidity): add SoulMetadata type definitions with parser"
```

---

## Task 10: Fork Desktop-Claw into desktop/

**Files:**
- Replace: `desktop/` entirely

- [ ] **Step 1: Clean out stale desktop directory**

```bash
rm -rf desktop/src-tauri desktop/node_modules
```

- [ ] **Step 2: Clone Desktop-Claw**

```bash
git clone --depth 1 https://github.com/DjTaNg-404/Desktop-Claw.git /tmp/desktop-claw
```

- [ ] **Step 3: Copy workspace into desktop/**

```bash
cp -r /tmp/desktop-claw/* desktop/
cp /tmp/desktop-claw/.* desktop/ 2>/dev/null || true
rm -rf desktop/.git
```

- [ ] **Step 4: Verify workspace structure**

Expected structure:
```
desktop/
├── apps/desktop/          # Electron app
│   ├── src/main/          # Main process
│   ├── src/preload/       # Preload scripts
│   ├── src/renderer/      # React renderer
│   ├── resources/         # App resources
│   └── electron.vite.config.ts
├── packages/backend/      # Backend package
├── packages/shared/       # Shared types
├── package.json           # pnpm workspace root
└── pnpm-workspace.yaml
```

Run: `ls desktop/apps/desktop/src/main/ desktop/packages/shared/`
Expected: Files exist.

- [ ] **Step 5: Install dependencies and verify dev starts**

```bash
cd desktop && pnpm install && pnpm dev
```

Verify the overlay window appears. Ctrl+C to stop.

- [ ] **Step 6: Apply Soulidity branding**

Update `desktop/apps/desktop/package.json`:
- `name` → `@soulidity/desktop`
- `productName` → `Soulidity Desktop`
- `description` → `Soulidity Desktop Persona Manager`

Update any references to "Desktop Claw" in UI text, window titles, and about info.

- [ ] **Step 7: Commit**

```bash
git add desktop/
git commit -m "feat(desktop): fork Desktop-Claw as Electron base, rebrand to Soulidity"
```

---

## Task 11: Electron status watcher

**Files:**
- Create: `desktop/apps/desktop/src/main/status-watcher.ts`
- Modify: `desktop/apps/desktop/src/main/index.ts`

- [ ] **Step 1: Implement status-watcher.ts**

```typescript
// desktop/apps/desktop/src/main/status-watcher.ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { BrowserWindow } from 'electron'
import { parseAgentStatusFile, deriveAggregateStatus } from '@soulidity/shared/types/cli-status'
import type { AgentStatusFile, CliAgentStatus } from '@soulidity/shared/types/cli-status'

const SOULIDITY_DIR = path.join(os.homedir(), '.soulidity')
const STATUS_FILE = path.join(SOULIDITY_DIR, 'agent-status.json')

let watcher: fs.FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let currentStatus: AgentStatusFile | null = null

function ensureDir() {
  fs.mkdirSync(SOULIDITY_DIR, { recursive: true })
}

function readCurrent(): AgentStatusFile | null {
  try {
    const raw = fs.readFileSync(STATUS_FILE, 'utf-8')
    return parseAgentStatusFile(raw)
  } catch {
    return null
  }
}

function broadcastToWindows(status: AgentStatusFile) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('agent-status-changed', status)
  }
}

export function getCurrentAgentStatus(): AgentStatusFile | null {
  return currentStatus
}

export function getAggregateCliStatus(): CliAgentStatus {
  return currentStatus ? deriveAggregateStatus(currentStatus) : 'idle'
}

export function startStatusWatcher() {
  ensureDir()
  currentStatus = readCurrent()

  watcher = fs.watch(SOULIDITY_DIR, (eventType, filename) => {
    if (filename !== 'agent-status.json') return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      const parsed = readCurrent()
      if (parsed) {
        currentStatus = parsed
        broadcastToWindows(parsed)
      }
    }, 100)
  })
}

export function stopStatusWatcher() {
  if (watcher) {
    watcher.close()
    watcher = null
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}
```

- [ ] **Step 2: Register watcher in main process**

In `desktop/apps/desktop/src/main/index.ts`, add:

```typescript
import { startStatusWatcher, stopStatusWatcher } from './status-watcher'

// In app.whenReady():
startStatusWatcher()

// In app.on('will-quit'):
stopStatusWatcher()
```

- [ ] **Step 3: Add preload API**

In preload script, expose:
```typescript
onAgentStatusChanged: (callback) => ipcRenderer.on('agent-status-changed', (_e, status) => callback(status)),
getCurrentAgentStatus: () => ipcRenderer.invoke('get-current-agent-status'),
```

Register the handler in main:
```typescript
ipcMain.handle('get-current-agent-status', () => getCurrentAgentStatus())
```

- [ ] **Step 4: Commit**

```bash
git add desktop/apps/desktop/src/main/status-watcher.ts desktop/apps/desktop/src/main/index.ts desktop/apps/desktop/src/preload/
git commit -m "feat(desktop): add agent-status.json file watcher with IPC broadcasting"
```

---

## Task 12: Sprite sheet renderer

**Files:**
- Create: `desktop/apps/desktop/src/renderer/components/SpriteRenderer.tsx`
- Create: `desktop/apps/desktop/src/renderer/hooks/useCliStatus.ts`

- [ ] **Step 1: Implement useCliStatus hook**

```typescript
// desktop/apps/desktop/src/renderer/hooks/useCliStatus.ts
import { useState, useEffect } from 'react'
import type { CliAgentStatus, AgentStatusFile } from '@soulidity/shared/types/cli-status'

const CLI_TO_EMOTION: Record<CliAgentStatus, string> = {
  idle: 'idle',
  thinking: 'busy',
  working: 'busy',
  completed: 'done',
  'needs-attention': 'night',
  error: 'night',
}

export function useCliStatus() {
  const [status, setStatus] = useState<CliAgentStatus>('idle')

  useEffect(() => {
    // Initial read
    window.electron.getCurrentAgentStatus().then((file: AgentStatusFile | null) => {
      if (file) {
        const sessions = Object.values(file.sessions).filter((s) => !s.endedAt)
        const latest = sessions.sort((a, b) => b.lastUpdated - a.lastUpdated)[0]
        if (latest) setStatus(latest.status)
      }
    })

    // Subscribe to changes
    const unsub = window.electron.onAgentStatusChanged((file: AgentStatusFile) => {
      const sessions = Object.values(file.sessions).filter((s) => !s.endedAt)
      const latest = sessions.sort((a, b) => b.lastUpdated - a.lastUpdated)[0]
      setStatus(latest?.status ?? 'idle')
    })

    return unsub
  }, [])

  return { status, emotion: CLI_TO_EMOTION[status] }
}
```

- [ ] **Step 2: Implement SpriteRenderer component**

```tsx
// desktop/apps/desktop/src/renderer/components/SpriteRenderer.tsx
import { useRef, useEffect, useCallback } from 'react'

export interface SpriteSheetConfig {
  src: string
  frameWidth: number
  frameHeight: number
  columns: number
  animations: {
    [stateName: string]: {
      frames: number[]
      fps: number
      loop: boolean
    }
  }
}

interface SpriteRendererProps {
  config: SpriteSheetConfig
  animation: string
  width?: number
  height?: number
}

export function SpriteRenderer({ config, animation, width, height }: SpriteRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sheetRef = useRef<HTMLImageElement | null>(null)
  const rafRef = useRef<number>(0)
  const frameRef = useRef(0)
  const lastTimeRef = useRef(0)
  const currentAnimRef = useRef(animation)

  const drawFrame = useCallback((ctx: CanvasRenderingContext2D, frameIndex: number) => {
    const col = frameIndex % config.columns
    const row = Math.floor(frameIndex / config.columns)
    ctx.clearRect(0, 0, config.frameWidth, config.frameHeight)
    if (sheetRef.current) {
      ctx.drawImage(
        sheetRef.current,
        col * config.frameWidth, row * config.frameHeight,
        config.frameWidth, config.frameHeight,
        0, 0,
        config.frameWidth, config.frameHeight,
      )
    }
  }, [config])

  useEffect(() => {
    const img = new Image()
    img.src = config.src
    img.onload = () => { sheetRef.current = img }
    return () => { sheetRef.current = null }
  }, [config.src])

  useEffect(() => {
    if (animation !== currentAnimRef.current) {
      currentAnimRef.current = animation
      frameRef.current = 0
      lastTimeRef.current = 0
    }
  }, [animation])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const tick = (timestamp: number) => {
      const anim = config.animations[currentAnimRef.current]
      if (!anim || !sheetRef.current) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      const interval = 1000 / anim.fps
      if (timestamp - lastTimeRef.current >= interval) {
        lastTimeRef.current = timestamp
        drawFrame(ctx, anim.frames[frameRef.current])
        frameRef.current++
        if (frameRef.current >= anim.frames.length) {
          frameRef.current = anim.loop ? 0 : anim.frames.length - 1
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [config, drawFrame])

  return (
    <canvas
      ref={canvasRef}
      width={config.frameWidth}
      height={config.frameHeight}
      style={{ width: width ?? config.frameWidth, height: height ?? config.frameHeight }}
    />
  )
}
```

- [ ] **Step 3: Wire SpriteRenderer into the floating ball / overlay**

Replace or augment the existing floating ball component in `desktop/apps/desktop/src/renderer/components/FloatingBall/index.tsx` to use `SpriteRenderer` when a sprite config is available.

- [ ] **Step 4: Bundle a default persona sprite config**

Create `desktop/apps/desktop/resources/default-persona/sprite-config.json`:

```json
{
  "src": "sheet.png",
  "frameWidth": 64,
  "frameHeight": 64,
  "columns": 6,
  "animations": {
    "idle":            { "frames": [0, 1, 2, 3],       "fps": 4,  "loop": true },
    "thinking":        { "frames": [6, 7, 8, 9],       "fps": 6,  "loop": true },
    "working":         { "frames": [12, 13, 14, 15],   "fps": 8,  "loop": true },
    "needs-attention": { "frames": [18, 19, 20, 21],   "fps": 4,  "loop": true },
    "completed":       { "frames": [24, 25, 26],        "fps": 4,  "loop": false },
    "error":           { "frames": [30, 31],             "fps": 2,  "loop": true }
  }
}
```

Create a placeholder `sheet.png` (64x64 grid, 6 columns) — can be a simple colored-square placeholder initially.

- [ ] **Step 5: Commit**

```bash
git add desktop/apps/desktop/src/renderer/components/SpriteRenderer.tsx \
       desktop/apps/desktop/src/renderer/hooks/useCliStatus.ts \
       desktop/apps/desktop/src/renderer/components/FloatingBall/ \
       desktop/apps/desktop/resources/default-persona/
git commit -m "feat(desktop): add sprite sheet renderer + CLI status hook + default persona"
```

---

## Task 13: Agent wallet module

**Files:**
- Create: `desktop/apps/desktop/src/main/agent-wallet.ts`
- Modify: `desktop/apps/desktop/src/main/index.ts`
- Modify: `desktop/apps/desktop/src/preload/index.ts`

- [ ] **Step 1: Install dependencies**

```bash
cd desktop/apps/desktop && pnpm add @mysten/sui keytar
```

- [ ] **Step 2: Implement agent-wallet.ts**

```typescript
// desktop/apps/desktop/src/main/agent-wallet.ts
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import * as keytar from 'keytar'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'

const KEYTAR_SERVICE = 'soulidity-desktop'
const KEYTAR_ACCOUNT = 'agent-keypair'
const PUBLIC_METADATA_FILE = 'agent_keypair.json'

export interface AgentKeypairInfo {
  address: string
  publicKey: string
  createdAt: number
}

function getMetadataPath(): string {
  return path.join(app.getPath('userData'), 'state', PUBLIC_METADATA_FILE)
}

export async function loadAgentKeypair(): Promise<AgentKeypairInfo | null> {
  const metaPath = getMetadataPath()
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8')
    return JSON.parse(raw) as AgentKeypairInfo
  } catch {
    return null
  }
}

export async function generateAgentKeypair(): Promise<AgentKeypairInfo> {
  // Check if already exists
  const existing = await loadAgentKeypair()
  if (existing) return existing

  const keypair = new Ed25519Keypair()
  const address = keypair.toSuiAddress()
  const publicKey = Buffer.from(keypair.getPublicKey().toRawBytes()).toString('hex')
  const secretKey = Buffer.from(keypair.getSecretKey()).toString('hex')

  // Store private key in OS keychain
  await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, secretKey)

  // Store public metadata
  const info: AgentKeypairInfo = {
    address,
    publicKey,
    createdAt: Date.now(),
  }
  const metaPath = getMetadataPath()
  fs.mkdirSync(path.dirname(metaPath), { recursive: true })
  fs.writeFileSync(metaPath, JSON.stringify(info, null, 2))

  return info
}

export async function exportAgentAddress(): Promise<string> {
  const info = await loadAgentKeypair()
  if (!info) throw new Error('Agent keypair not generated')
  return info.address
}
```

- [ ] **Step 3: Register IPC handlers in main process**

In `desktop/apps/desktop/src/main/index.ts`:

```typescript
import { generateAgentKeypair, loadAgentKeypair, exportAgentAddress } from './agent-wallet'

ipcMain.handle('generate-agent-keypair', () => generateAgentKeypair())
ipcMain.handle('load-agent-keypair', () => loadAgentKeypair())
ipcMain.handle('export-agent-address', () => exportAgentAddress())
```

- [ ] **Step 4: Expose in preload**

```typescript
generateAgentKeypair: () => ipcRenderer.invoke('generate-agent-keypair'),
loadAgentKeypair: () => ipcRenderer.invoke('load-agent-keypair'),
exportAgentAddress: () => ipcRenderer.invoke('export-agent-address'),
```

- [ ] **Step 5: Auto-generate on first launch**

In `app.whenReady()` after status watcher start:

```typescript
generateAgentKeypair().catch((err) => console.warn('Agent keypair generation deferred:', err.message))
```

- [ ] **Step 6: Add wallet display in settings**

Create a minimal component in `desktop/apps/desktop/src/renderer/components/AgentWallet/index.tsx` that shows address + publicKey from `loadAgentKeypair()` IPC, with a "Copy Address" button.

Wire it into the existing settings panel.

- [ ] **Step 7: Commit**

```bash
git add desktop/apps/desktop/src/main/agent-wallet.ts \
       desktop/apps/desktop/src/main/index.ts \
       desktop/apps/desktop/src/preload/ \
       desktop/apps/desktop/src/renderer/components/AgentWallet/
git commit -m "feat(desktop): add Ed25519 agent wallet with OS keychain + settings UI"
```

---

## Task 14: LLM config placeholder

**Files:**
- Create: `desktop/apps/desktop/src/main/llm-config.ts`
- Modify: `desktop/apps/desktop/src/main/index.ts`

- [ ] **Step 1: Implement llm-config.ts**

```typescript
// desktop/apps/desktop/src/main/llm-config.ts
import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'

export interface LlmConfig {
  provider: 'anthropic' | 'openai' | 'local' | 'custom'
  apiKey?: string
  useLocalSubscription: boolean
  customEndpoint?: string
  model?: string
}

const CONFIG_FILE = 'llm_config.json'

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'state', CONFIG_FILE)
}

export async function loadLlmConfig(): Promise<LlmConfig | null> {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8')
    return JSON.parse(raw) as LlmConfig
  } catch {
    return null
  }
}

export async function saveLlmConfig(config: LlmConfig): Promise<void> {
  const configPath = getConfigPath()
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}
```

- [ ] **Step 2: Register IPC + preload**

In main:
```typescript
import { loadLlmConfig, saveLlmConfig } from './llm-config'
ipcMain.handle('load-llm-config', () => loadLlmConfig())
ipcMain.handle('save-llm-config', (_e, config) => saveLlmConfig(config))
```

In preload:
```typescript
loadLlmConfig: () => ipcRenderer.invoke('load-llm-config'),
saveLlmConfig: (config) => ipcRenderer.invoke('save-llm-config', config),
```

- [ ] **Step 3: Add minimal settings UI**

Add a "LLM Configuration" section in the settings panel with:
- Provider dropdown (anthropic / openai / local / custom)
- API key input (password field)
- "Use local subscription" toggle
- Custom endpoint input (shown when provider = custom)
- Save button

This is a placeholder — it saves but doesn't call any LLM.

- [ ] **Step 4: Commit**

```bash
git add desktop/apps/desktop/src/main/llm-config.ts desktop/apps/desktop/src/main/index.ts desktop/apps/desktop/src/preload/ desktop/apps/desktop/src/renderer/
git commit -m "feat(desktop): add LLM config placeholder with settings UI"
```

---

## Task 15: Verification — all acceptance criteria

- [ ] **Step 1: Run Move tests**

```bash
sui move test --path move/soulidity 2>&1 | tail -20
```
Expected: ALL PASS (32 existing + new asset/content-access tests).

- [ ] **Step 2: Run Vitest**

```bash
npm test 2>&1 | tail -30
```
Expected: ALL PASS.

- [ ] **Step 3: Run typecheck**

```bash
npm --prefix web run typecheck 2>&1 | tail -20
```
Expected: No type errors.

- [ ] **Step 4: Run build**

```bash
npm --prefix web run build 2>&1 | tail -20
```
Expected: Build succeeds.

- [ ] **Step 5: Verify hook adapter works manually**

```bash
echo '{"event":"SessionStart","session_id":"test-1"}' | node desktop/apps/desktop/resources/hooks/soulidity-claude-hook.js
cat ~/.soulidity/agent-status.json
```
Expected: Valid JSON with session `test-1` in `idle` status.

- [ ] **Step 6: Verify desktop app starts (if dependencies installed)**

```bash
cd desktop && pnpm dev
```
Expected: Overlay window appears with placeholder sprite.

- [ ] **Step 7: Commit any remaining fixes**

Fix any issues found during verification, then commit.

- [ ] **Step 8: Final summary**

Verify all acceptance criteria from the spec:
1. ✅ Claude Code hook writes status → overlay can read it
2. ✅ Codex hook writes status → overlay can read it
3. ✅ Metadata types allow parsing persona from marketplace Soul
4. ✅ Asset append API route exists
5. ✅ Content access purchase API route exists (pre-existing)
6. ✅ Content access add API route exists (pre-existing)
7. ✅ Agent keypair generated on desktop first launch
8. ✅ Grant-based access works (pre-existing Move + API)
9. ✅ LLM config saves to local file
10. ✅ `sui move test` passes
11. ✅ `npm test` passes
12. ✅ `npm --prefix web run typecheck` passes
13. ✅ `npm --prefix web run build` passes
