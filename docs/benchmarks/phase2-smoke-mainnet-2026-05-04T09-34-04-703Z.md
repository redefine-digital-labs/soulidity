# Phase 2 Soulidity smoke (mainnet)

Generated: 2026-05-04T09:34:04.703Z
Package: `0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0`
Mode: dryRun-only

| Scenario | Expected | Outcome | Detail |
|---|---|---|---|
| §12.1 mint positive (4 kinds + state config) | pass | FAIL | build error: Error checking transaction input objects: Object 0x9194b85aff3fbf882ef24e46b7096001ee006246f2fec511957a0177351b3c1a is owned by object 0x2a88bf3960b32b6cd84cb7a13dac66368a51943b7db890e744d5f327e372c6c9. Objects owned by other objects cannot be used as input arguments |
| §12.2.a mint without SOUL_DOC → EInitialSoulDocCountMismatch (46) | abort 46 (market) | PASS | client validator threw: mint requires exactly 1 SOUL_DOC entry; got 0 |
| §12.2.b SOUL_DOC name="other" → EInitialSoulDocNameMismatch (47) | abort 47 (market) | PASS | client validator threw: SOUL_DOC entry name must be "soul" |
| §12.2.c mint without MEMORY → EInitialMemoryCountMismatch (48) | abort 48 (market) | PASS | client validator threw: mint requires at least 1 MEMORY entry; got 0 |
| §12.2.d MEMORY name="custom" → EInitialMemoryNameMismatch (49) | abort 49 (market) | PASS | client validator threw: MEMORY entry name must be "default" |
| §12.3.SEAL issue_to_grantee scope=SEAL (mask=1) | pass | PASS | dryRun ok |
| §12.3.MEMORY issue_to_grantee scope=MEMORY (mask=2) | pass | PASS | dryRun ok |
| §12.3.SKILLS issue_to_grantee scope=SKILLS (mask=4) | pass | PASS | dryRun ok |
| §12.3.ASSETS issue_to_grantee scope=ASSETS (mask=8) | pass | PASS | dryRun ok |
| §12.3.ALL issue_to_grantee scope=ALL (mask=15) | pass | PASS | dryRun ok |
| §12.3.revoke revoke grantee dry-run | pass | FAIL | build error: Transaction resolution failed: MoveAbort in 1st command, abort code: 9, in '0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0::grant::revoke' (instruction 20) |
| §12.4.configure configure_paid_access_kind sprite scope=ASSETS price=1_000_000 | pass | PASS | dryRun ok |
| §12.4.purchase purchase_paid_access (sprite, with platform fee) | pass | FAIL | build error: Transaction resolution failed: MoveAbort in 2nd command, abort code: 51, in '0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0::market::purchase_paid_access' (instruction 79) |
| §12.4.delete delete_paid_access_kind (sprite) | pass | FAIL | build error: Transaction resolution failed: MoveAbort in 1st command, abort code: 7, in '0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0::paid_access::delete_paid_access_kind' (instruction 26) |
| §12.5.a mint sprite with READ_OWNER|READ_PUBLIC, public download policy | pass | FAIL | build error: Error checking transaction input objects: Object 0x9194b85aff3fbf882ef24e46b7096001ee006246f2fec511957a0177351b3c1a is owned by object 0x2a88bf3960b32b6cd84cb7a13dac66368a51943b7db890e744d5f327e372c6c9. Objects owned by other objects cannot be used as input arguments |
| §12.5.b sprite READ_PUBLIC only (no OWNER) → EOwnerReadModeRequired (29) or client throw | abort 29 (content) | PASS | client validator threw: slot read_mode_mask must include READ_OWNER |
| §12.6.a append memory v1 (default) | pass | FAIL | build error: Error checking transaction input objects: Object 0xaa1bee519baefb0d432117361723306b91cfa1e7bd68983df59ea5c09f620d71 is owned by object 0x54e15389324a05389880e3d1ba5ae7afe203b8971fc80200ef7274320dae673f. Objects owned by other objects cannot be used as input arguments |
| §12.6.b delete memory v0 | pass | PASS | dryRun ok |
| §12.6.c purge after delete | pass | SKIP | requires --execute (delete, then purge in next TX) |
| §12.7.a list_soul_fixed_price (price=1_000_000) | pass | PASS | dryRun ok |
| §12.7.b buy_soul_fixed_price | pass | SKIP | PHASE2_SMOKE_LISTING_ID + buyer + USDC required |
| §12.8 create_collection_in_personal_kiosk (tradeable, max_supply=100) | pass | FAIL | build error: Transaction resolution failed: MoveAbort in 3rd command, abort code: 14, in '0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0::market::insert_or_assert_personal_kiosk_registration' (instruction 23) |
| §12.9 list/buy collection right | pass | SKIP | PHASE2_SMOKE_COLLECTION_ID + KIOSK_ID + KIOSK_CAP_ID required (run §12.8 with --execute first) |
| §12.10 publishWithBind into existing collection | pass | SKIP | PHASE2_SMOKE_COLLECTION_ID required (run §12.8 with --execute first) |
