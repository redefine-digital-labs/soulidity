-- Soulidity package redeploy hard cut (testnet):
-- `web/lib/soulidity/deployment-manifest.json` has been switched to a brand-new
-- package (`original-id` == `published-at`, version = 1 in `move/soulidity/Published.toml`),
-- not an upgrade of the previous package. Every mirrored on-chain object ID
-- stored in the projection tables belongs to the old package and cannot be
-- reused with the new package's transaction builders — any marketplace action
-- against a stale row would build a PTB referencing the old package and abort
-- on-chain. Mirrors repopulate on the next post-TX write for each route.
--
-- Cascade relations from `soul_assets` drop the dependent projection rows:
--   soul_grant_records, soul_memory_entries, soul_skill_version_records,
--   soul_asset_version_records, content_access_records, bookmarks.

DELETE FROM "soul_prepared_purchases";
DELETE FROM "soul_tx_syncs";
DELETE FROM "soul_assets";
DELETE FROM "soul_collection_assets";
