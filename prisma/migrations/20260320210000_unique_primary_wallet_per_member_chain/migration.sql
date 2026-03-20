-- Ensure at most one primary wallet per (member, chain).
-- Prevents concurrent bind-confirm requests from both inserting isPrimary = true.
CREATE UNIQUE INDEX wallet_bindings_member_chain_primary_unique
  ON wallet_bindings (member_id, chain)
  WHERE is_primary = true;
