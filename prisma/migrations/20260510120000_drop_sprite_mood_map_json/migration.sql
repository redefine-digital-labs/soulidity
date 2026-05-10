-- Drop the cached `sprite_mood_map_json` column from `soul_assets`.
--
-- The column mirrored a manual JSON upload that's now removed from the
-- Persona Sprite UI. The runtime sprite contract derives the mood→animation
-- map directly from the sprite config's animation keys via
-- `buildFallbackMoodMap`, so the cached snapshot has no remaining readers.
-- On-chain `state.config_ext['sprite_mood_map_json']` entries on previously
-- minted Souls become orphan keys; they are never read by the application.
ALTER TABLE "soul_assets"
  DROP COLUMN IF EXISTS "sprite_mood_map_json";
