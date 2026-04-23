# Plan

1. Normalize metadata
   - add canonical `moodMap` normalization
   - validate `publicAssets` / `protectedAssets`
   - resolve `spriteDownloadPolicy`

2. Unify web desktop contract
   - repository returns listing + price + sprite policy
   - manifest carries normalized sprite manifest
   - `/api/desktop/catalog/[id]` gates public vs owner-only by metadata policy
   - add shared asset version access helper

3. Unify desktop runtime
   - downloader switches from bundle-first to metadata-first
   - cache canonicalizes `persona-sprite.*`
   - renderer supports owner-only decrypt + cache
   - library UI shows listed truth and policy-specific download state

4. Producer plumbing
   - canonical default initial asset name becomes `persona-sprite`
   - pass through optional metadata/asset inputs without minting new legacy defaults

5. Verify
   - metadata tests
   - desktop catalog repository/route tests
   - desktop cache/downloader/UI tests
