# Animacraft Protocol Integration

## Status

Implementation candidate for Soulidity `master`. This specification does not
authorize a Mainnet upgrade by itself.

## Goal

Consume an Animacraft protocol-v4 `CanonicalSoulMintAuthorization` and create
exactly one canonical Soulidity Soul in the user's registered personal Kiosk. Preserve
verified Maker provenance through later sales, keep the existing Soulidity
platform fee at 250 bps (2.5%), and route the Maker's separate 0%-5% resale
royalty into the matching Animacraft Maker Treasury.

## Product Boundary

- Animacraft owns Maker publication, recipe validation, primary paid-mint
  settlement, Maker policy snapshots, and Maker Treasury accounting.
- Soulidity owns the finished Soul, Living Content, personal Kiosk custody,
  public profile/social presentation, listings, purchases, and ownership
  rotation.
- No Soul or OC NFT is created by Animacraft.
- No generic imported-mint field may claim verified Animacraft provenance.

## Contract Scope

1. Pin the reviewed Animacraft repository commit and Mainnet original package
   ID in `move/soulidity/Move.toml` and the generated lockfile.
2. Add provenance kind `3` and a one-time dynamic-field binding on
   `SoulState`, preserving the layout of every existing Mainnet object. The
   binding uses a protocol-reserved primitive `u8` key so future package
   upgrades do not lose it through a version-specific key type identity.
3. Add a frozen `AnimacraftProvenance` object containing the consumed
   canonical authorization, Protocol Fee gate/split evidence, and immutable
   Maker royalty policy.
4. Add `mint_animacraft_in_personal_kiosk`, which consumes the authorization,
   enforces protocol version 4, native Sui USDC, sender/payer equality, and
   existing Soulidity Living Content invariants, then creates one Soul with
   Soulidity creator royalty set to zero.
5. Reject Animacraft-bound Souls in generic listing and purchase entries. Add
   dedicated solo and collection listing entries that validate platform,
   immutable Maker, and collection royalties before publishing a listing, plus
   dedicated purchase entries that preserve the 2.5% Soulidity fee and deposit
   the exact floor-rounded Maker royalty into the matching Animacraft Treasury.
6. Keep Maker AdminCap trading outside this adapter. It is a separate escrow
   product and must not be approximated by changing Maker provenance.

## Web Scope

- Animacraft links a connected wallet into Soulidity My Souls, profile, and
  community routes with a non-secret wallet address/deep-link context.
- Soulidity treats its own wallet signature/session as the authentication
  boundary; query parameters never authenticate a user.
- The browser binds profile and image URLs to their certified Walrus quilt
  patch IDs and accepts Maker objects only from Animacraft's Mainnet type
  origin before requesting any new upload or mint signature.
- Canonical mint remains feature-gated until both upgraded package IDs and
  object IDs are recorded and the full Mainnet evidence run passes.

## Economics

- Paid primary Maker mint: Animacraft atomically splits 50% to Maker Treasury
  and 50% to Protocol Treasury before returning the authorization.
- Secondary Soul sale: Soulidity platform fee remains 250 bps (2.5%).
- Maker resale royalty: an additional immutable 0%, 1%, 2%, 3%, 4%, or 5%
  snapshot routed once to the Maker Treasury.
- Soulidity creator royalty is zero for Animacraft Souls to prevent charging
  or paying the wrong party twice.

## Acceptance

1. Free and paid canonical authorizations each create exactly one
   provenance-kind-3 Soul; the immutable original-package legacy authorization
   type cannot enter the Soulidity mint signature.
2. Authorization payer must equal the transaction sender and cannot be reused
   or left unconsumed.
3. Required Soul document and founding Memory validation remains unchanged.
4. Wrong protocol version, coin type, Maker, Treasury, provenance, or Soul
   linkage aborts.
5. Generic listing and purchase paths reject Animacraft-bound Souls.
6. Dedicated listings reject fee stacks above 100% and prices too small to
   settle a nonzero Maker royalty before the listing becomes public.
7. Dedicated purchases collect exactly 2.5% platform fee plus the floor-rounded
   Maker royalty and optional existing collection royalty; seller receives the
   unchanged listing price.
8. Existing native, imported, personal-join, listing, content, and paid-access
   tests remain green.
9. Move source verifies/builds, SDK tests pass, and deployment documentation
   identifies every human-signed Mainnet step.

## Rollback

- Before Mainnet signing: close the integration PR; existing packages and web
  release gates remain unchanged.
- After package upgrade but before web activation: keep canonical Animacraft
  mint disabled; old Soulidity paths remain available for non-Animacraft Souls.
- The deployed package cannot be deleted. Any post-activation correction must
  be an independently reviewed upgrade signed by protocol custody.
