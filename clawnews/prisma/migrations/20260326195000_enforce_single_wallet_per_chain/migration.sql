WITH ranked_wallet_bindings AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY member_id, chain
      ORDER BY is_primary DESC, created_at ASC, id ASC
    ) AS row_num
  FROM wallet_bindings
)
DELETE FROM wallet_bindings wb
USING ranked_wallet_bindings ranked
WHERE wb.id = ranked.id
  AND ranked.row_num > 1;

DROP INDEX IF EXISTS wallet_bindings_member_id_chain_idx;
CREATE UNIQUE INDEX wallet_bindings_member_id_chain_key
  ON wallet_bindings(member_id, chain);
