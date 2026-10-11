# Animacraft to Soulidity Mainnet Activation Runbook

## Purpose

Activate one canonical path from an Animacraft Character Maker to a Soulidity
Soul. Animacraft owns Maker rules, administration, primary mint revenue, and
Maker royalty policy. Soulidity owns the only finished Soul, Living Content,
personal Kiosk custody, social identity, and secondary settlement.

This runbook is intentionally fail-closed. Do not enable the browser release
gate until every object ID and transaction listed below has independent review.

## Release order

1. Merge and tag the reviewed Animacraft v4 source.
2. Upgrade the existing Animacraft package with its existing `UpgradeCap`.
3. Record the v4 callable package ID, digest, checkpoint, source commit, and CLI
   version. Keep the original package ID unchanged as the type identity.
4. Initialize exactly one `ProtocolFeeConfig` and one
   `ProtocolTreasury<USDC>` with a 5,000 bps primary protocol share.
5. In Soulidity `Move.toml`, keep Animacraft `original-id` equal to
   `0x9678afa6b008ddd0637b7723e30beac1c2a1d096b39c76b103f1a1841dc1ffea`,
   but replace its Mainnet `published-at` with the reviewed v4
   callable package ID. Rebuild and inspect `Move.lock`.
6. Merge and tag the reviewed Soulidity adapter source.
7. Upgrade the existing Soulidity package with its own `UpgradeCap` and record
   the new callable package ID and source evidence.
8. Update the Soulidity deployment manifest and Vercel environment, but keep
   `NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED=false`.
9. Run the signed smoke matrix below with the candidate web deployment.
10. Enable the gate only after the evidence is attached to both release PRs.

Never publish either repository as a new unrelated package. Animacraft and
Soulidity retain separate upgrade caps and separate multisig custody.

## Required Soulidity production environment

```dotenv
NEXT_PUBLIC_SUI_NETWORK=mainnet
NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED=false
NEXT_PUBLIC_ANIMACRAFT_PACKAGE_ID=0x_V4_CALLABLE_PACKAGE
NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_FEE_CONFIG_ID=0x_PROTOCOL_FEE_CONFIG
NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_TREASURY_ID=0x_PROTOCOL_TREASURY_USDC
```

Run the production env sync in dry-run mode first:

```bash
npm run vercel:sync-production-env -- --env-file .env.production --dry-run
```

The sync script rejects an enabled gate when any Animacraft object ID is
missing or malformed. Private keys are forbidden from this environment file.

## Pre-deployment gates

From the Soulidity repository root:

```bash
npm ci --ignore-scripts
npm --prefix web ci --ignore-scripts
npm --prefix packages/soulidity-sdk run typecheck
npm --prefix web run typecheck
npx vitest run tests/new-web/sdk-animacraft-builders.test.ts \
  tests/new-web/market-errors.test.ts \
  tests/new-web/animacraft-handoff.test.ts \
  tests/new-web/agent-soul-detail-route.test.ts \
  tests/new-web/agent-purchase-prepare-route.test.ts \
  tests/new-web/soulidity-queries-parsing.test.ts
cd move/soulidity && sui move test --build-env mainnet
```

Also run `npm audit --omit=dev`. A production high or critical advisory blocks
promotion. Record any dev-only residual advisory with its exposure analysis.

## Signed smoke matrix

Use distinct creator, OC user, buyer, and protocol-custody addresses.

1. Publish a minimal free Maker, create an OC, and confirm one canonical Soul
   is minted with provenance kind `animacraft` and mandatory Soul/Memory data.
2. Interrupt projection sync after the mint transaction, reload, and confirm
   the UI resumes `/api/souls/publish` without signing or minting again.
3. Publish a paid Maker at a small native Sui USDC price. Confirm the exact
   gross amount is split 50/50: protocol receives floor(gross / 2), Maker
   Treasury receives the remainder.
4. Confirm only the current `MakerAdminCap` holder can update future economics,
   archive/restore, and withdraw Maker Treasury revenue.
5. List the resulting Soul through the provenance-aware listing entry and buy
   it from another wallet. Confirm Soulidity receives exactly 2.5% of listing
   price and the immutable Maker royalty tier (0% or 1%-5%) reaches the matching
   Maker Treasury exactly once.
6. Confirm generic Soul listing and purchase functions reject the Animacraft
   Soul, and that an invalid combined fee stack fails before a listing object is
   shared.
7. Repeat a purchase through the Agent API and compare its quoted total and
   prepared PTB with the human checkout.
8. Open My Souls, Profile, Community, and Market from Animacraft. Wallet query
   hints must never authorize a Soulidity session.

Record every digest, object ID, balance delta, and address role. Redact no
public chain data, but never record seed phrases or private keys.

## Activation and rollback

After the smoke evidence is approved, set the canonical gate to `true`, run the
Vercel env sync with `--apply`, deploy a Preview, repeat read-only checks, then
promote that exact deployment.

If web behavior is wrong, turn the gate off and roll Vercel back. If a Maker is
wrong, archive it with its Cap. If a contract invariant is wrong, stop
onboarding and use the relevant multisig upgrade process; on-chain history and
existing Soul provenance are never deleted.

## Current blockers

- Animacraft v4 callable package ID has not yet been recorded in this branch.
- The v4 Protocol Fee config and Protocol Treasury object IDs do not yet exist
  in committed deployment evidence.
- The Soulidity adapter upgrade has not yet been published or source-verified.
- Signed Mainnet free, paid, recovery, and secondary-sale evidence is pending.

Until all four are cleared, the canonical browser gate remains `false`.
