# Plan

1. Add shared sprite primitives
   - parse sprite config JSON
   - derive canonical moodMap from animation names
   - build canonical metadata JSON/file payload
   - add asset append/delete tx builder

2. Wire mint-time sprite inputs
   - extend create/import/wrap/collection provider state
   - add upload controls and preview copy
   - upload sprite image + metadata
   - pass `metadataRef`, `assetBlobObjectId`, `assetVisibility`, `assetType`, `assetsSealSidecar`

3. Front-load validation and recovery correctness
   - batch folder parser rejects half-configured sprite folders
   - public sprite uploads still bind blob ownership to the signer for tx use
   - recovery keeps `spriteVisibility` and invalidates stale sprite metadata with missing blobs

4. Verify
   - run targeted vitest for metadata / tx builders
   - run focused typecheck or equivalent repo-local validation if available
