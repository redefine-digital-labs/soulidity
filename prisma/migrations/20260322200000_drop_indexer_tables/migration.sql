-- Drop indexer tables (replaced by post-TX direct DB writes)
-- Postgres migrations are wrapped by Prisma Migrate in a transaction.
-- Before applying in a non-empty environment:
-- 1. Stop the legacy indexer writers.
-- 2. Confirm `indexer_dead_letter_events` is empty.
-- 3. Confirm `indexer_cursors` is empty or archive the rows you still need.
-- 4. Apply this migration only after the post-TX mirror routes are live.
DO $$
BEGIN
    IF to_regclass('"indexer_dead_letter_events"') IS NOT NULL
       AND EXISTS (SELECT 1 FROM "indexer_dead_letter_events" LIMIT 1) THEN
        RAISE EXCEPTION 'Refusing to drop indexer_dead_letter_events while rows still exist';
    END IF;

    IF to_regclass('"indexer_cursors"') IS NOT NULL
       AND EXISTS (SELECT 1 FROM "indexer_cursors" LIMIT 1) THEN
        RAISE EXCEPTION 'Refusing to drop indexer_cursors while rows still exist';
    END IF;
END $$;

DROP TABLE IF EXISTS "indexer_dead_letter_events";
DROP TABLE IF EXISTS "indexer_cursors";
