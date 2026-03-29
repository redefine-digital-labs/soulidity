# Manual Index Registry

> Last updated: 2026-03-29

## `soul_assets_listing_object_on_chain_id_key`

- Migration: `20260329120000_hard_cut_soul_market_to_stablecoin_listing_objects`
- Table: `soul_assets`
- Definition: partial unique index on `("listing_object_on_chain_id") WHERE "listing_object_on_chain_id" IS NOT NULL`
- Reason: Prisma cannot represent partial unique indexes in `schema.prisma`, so this index must remain hand-managed.
- Verification: after `prisma migrate deploy`, confirm the index exists with the same predicate as the migration SQL.
