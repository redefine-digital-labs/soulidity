-- M-2 fix: ContentAccessEntry gains ownership_epoch_snapshot, matching the
-- SoulGrant contract. Entries recorded under a previous owner become stale
-- after Soul transfer; has_access compares this value to the current
-- SoulState.ownership_epoch.
--
-- Hard-cut: pre-existing mirror rows cannot supply a correct
-- ownership_epoch_snapshot — the column did not exist when they were
-- written, the Soul's ownership_epoch is on-chain only, and a default of 0
-- would silently deny access for every Soul whose current epoch is non-zero.
-- Following the established hard-cut pattern in this repo (see
-- 20260330160000_hard_cut_remove_legacy_soul_runtime_data), we drop legacy
-- mirror rows so the new epoch-pinned semantics start from a clean slate.
-- The on-chain ContentAccessList remains the source of truth; entries get
-- re-mirrored when buyers re-purchase or the owner re-issues `add_access`,
-- both of which now write the real on-chain epoch via the existing access
-- routes.
DELETE FROM "content_access_records";

ALTER TABLE "content_access_records"
  ADD COLUMN IF NOT EXISTS "ownership_epoch_snapshot" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "content_access_records"
  ALTER COLUMN "ownership_epoch_snapshot" DROP DEFAULT;
