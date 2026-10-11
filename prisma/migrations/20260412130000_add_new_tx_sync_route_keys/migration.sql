ALTER TABLE "soul_tx_syncs"
  DROP CONSTRAINT IF EXISTS "soul_tx_syncs_route_key_check";

ALTER TABLE "soul_tx_syncs"
  ADD CONSTRAINT "soul_tx_syncs_route_key_check"
  CHECK ("route_key" IN (
    'publish',
    'buy',
    'list',
    'delist',
    'grant:issue',
    'grant:revoke',
    'grant:revoke-scope',
    'skills:append',
    'skills:delete',
    'assets:append',
    'assets:delete',
    'collection:mint',
    'collection:list',
    'collection:delist',
    'collection:buy',
    'collection:add-soul',
    'import',
    'personal-join',
    'agent-buy',
    'content-access:purchase',
    'content-access:add',
    'content-access:revoke'
  ));
