-- Backfill any surviving legacy members.wallet values into canonical Sui wallet_bindings
-- before removing the deprecated column. Fail loudly if the legacy data conflicts
-- with the canonical wallet binding model instead of silently dropping information.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM members
    WHERE wallet IS NOT NULL
      AND lower(wallet) !~ '^(0x)?[0-9a-f]{1,64}$'
  ) THEN
    RAISE EXCEPTION 'Cannot migrate members.wallet: found invalid legacy wallet values';
  END IF;

  IF EXISTS (
    WITH legacy_wallets AS (
      SELECT
        m.id AS member_id,
        '0x' || lpad(lower(regexp_replace(m.wallet, '^0x', '', 'i')), 64, '0') AS canonical_address
      FROM members m
      WHERE m.wallet IS NOT NULL
    )
    SELECT canonical_address
    FROM legacy_wallets
    GROUP BY canonical_address
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot migrate members.wallet: duplicate canonical legacy wallet values found';
  END IF;

  IF EXISTS (
    WITH legacy_wallets AS (
      SELECT
        m.id AS member_id,
        '0x' || lpad(lower(regexp_replace(m.wallet, '^0x', '', 'i')), 64, '0') AS canonical_address
      FROM members m
      WHERE m.wallet IS NOT NULL
    ),
    existing_bindings AS (
      SELECT
        wb.member_id,
        '0x' || lpad(lower(regexp_replace(wb.address, '^0x', '', 'i')), 64, '0') AS canonical_address
      FROM wallet_bindings wb
      WHERE wb.chain = 'sui'
    )
    SELECT 1
    FROM legacy_wallets lw
    JOIN existing_bindings eb ON eb.canonical_address = lw.canonical_address
    WHERE eb.member_id <> lw.member_id
  ) THEN
    RAISE EXCEPTION 'Cannot migrate members.wallet: found legacy wallets already bound to another member';
  END IF;

  IF EXISTS (
    WITH legacy_wallets AS (
      SELECT
        m.id AS member_id,
        '0x' || lpad(lower(regexp_replace(m.wallet, '^0x', '', 'i')), 64, '0') AS canonical_address
      FROM members m
      WHERE m.wallet IS NOT NULL
    ),
    existing_bindings AS (
      SELECT
        wb.member_id,
        '0x' || lpad(lower(regexp_replace(wb.address, '^0x', '', 'i')), 64, '0') AS canonical_address
      FROM wallet_bindings wb
      WHERE wb.chain = 'sui'
    )
    SELECT 1
    FROM legacy_wallets lw
    WHERE EXISTS (
      SELECT 1
      FROM existing_bindings eb
      WHERE eb.member_id = lw.member_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM existing_bindings eb
      WHERE eb.member_id = lw.member_id
        AND eb.canonical_address = lw.canonical_address
    )
  ) THEN
    RAISE EXCEPTION 'Cannot migrate members.wallet: found members whose legacy wallet differs from existing Sui wallet bindings';
  END IF;
END $$;

WITH legacy_wallets AS (
  SELECT
    m.id AS member_id,
    m.joined_at,
    '0x' || lpad(lower(regexp_replace(m.wallet, '^0x', '', 'i')), 64, '0') AS canonical_address
  FROM members m
  WHERE m.wallet IS NOT NULL
)
INSERT INTO wallet_bindings (
  id,
  member_id,
  chain,
  address,
  is_primary,
  verified_at,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  lw.member_id,
  'sui',
  lw.canonical_address,
  true,
  lw.joined_at,
  lw.joined_at,
  lw.joined_at
FROM legacy_wallets lw
WHERE NOT EXISTS (
  SELECT 1
  FROM wallet_bindings wb
  WHERE wb.member_id = lw.member_id
    AND wb.chain = 'sui'
    AND '0x' || lpad(lower(regexp_replace(wb.address, '^0x', '', 'i')), 64, '0') = lw.canonical_address
);

ALTER TABLE members DROP COLUMN wallet;
