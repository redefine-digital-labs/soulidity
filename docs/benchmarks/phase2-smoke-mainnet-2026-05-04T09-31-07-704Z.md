# Phase 2 Soulidity smoke (mainnet)

Generated: 2026-05-04T09:31:07.705Z
Package: `0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0`
Mode: dryRun-only

| Scenario | Expected | Outcome | Detail |
|---|---|---|---|
| §12.2.a mint without SOUL_DOC → EInitialSoulDocCountMismatch (46) | abort 46 (market) | PASS | client validator threw: mint requires exactly 1 SOUL_DOC entry; got 0 |
| §12.2.b SOUL_DOC name="other" → EInitialSoulDocNameMismatch (47) | abort 47 (market) | PASS | client validator threw: SOUL_DOC entry name must be "soul" |
| §12.2.c mint without MEMORY → EInitialMemoryCountMismatch (48) | abort 48 (market) | PASS | client validator threw: mint requires at least 1 MEMORY entry; got 0 |
| §12.2.d MEMORY name="custom" → EInitialMemoryNameMismatch (49) | abort 49 (market) | PASS | client validator threw: MEMORY entry name must be "default" |
