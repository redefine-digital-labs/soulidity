# Manual Index Registry

> Last updated: 2026-04-30

## `soul_assets_listing_object_on_chain_id_key`

- Migration: `20260329120000_hard_cut_soul_market_to_stablecoin_listing_objects`
- Table: `soul_assets`
- Definition: partial unique index on `("listing_object_on_chain_id") WHERE "listing_object_on_chain_id" IS NOT NULL`
- Reason: Prisma cannot represent partial unique indexes in `schema.prisma`, so this index must remain hand-managed.
- Verification: after `prisma migrate deploy`, confirm the index exists with the same predicate as the migration SQL.

## `soul_assets_listed_name_trgm_idx`

- Migration: `20260430090000_add_soul_persona_kind_and_market_indexes`
- Table: `soul_assets`
- Definition: partial GIN trigram index on `("name" gin_trgm_ops) WHERE "listing_status" = 'listed'`
- Reason: Prisma cannot represent PostgreSQL trigram operator-class indexes with a partial predicate.
- Verification: after `prisma migrate deploy`, confirm `pg_trgm` is enabled and the index predicate remains `listing_status = 'listed'`.

## `soul_assets_listed_description_trgm_idx`

- Migration: `20260430090000_add_soul_persona_kind_and_market_indexes`
- Table: `soul_assets`
- Definition: partial GIN trigram index on `("description" gin_trgm_ops) WHERE "listing_status" = 'listed'`
- Reason: Prisma cannot represent PostgreSQL trigram operator-class indexes with a partial predicate.
- Verification: after `prisma migrate deploy`, confirm `pg_trgm` is enabled and the index predicate remains `listing_status = 'listed'`.
