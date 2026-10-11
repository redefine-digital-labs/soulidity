ALTER TABLE "soul_assets"
  DROP COLUMN IF EXISTS "metadata_ref",
  ADD COLUMN IF NOT EXISTS "metadata_on_chain_id" TEXT,
  ADD COLUMN IF NOT EXISTS "active_sprite_asset_name" TEXT,
  ADD COLUMN IF NOT EXISTS "active_sprite_version_index" INTEGER,
  ADD COLUMN IF NOT EXISTS "active_sprite_download_policy" TEXT,
  ADD COLUMN IF NOT EXISTS "active_voice_asset_name" TEXT,
  ADD COLUMN IF NOT EXISTS "active_voice_version_index" INTEGER,
  ADD COLUMN IF NOT EXISTS "active_voice_download_policy" TEXT,
  ADD COLUMN IF NOT EXISTS "sprite_config_json" TEXT,
  ADD COLUMN IF NOT EXISTS "sprite_mood_map_json" TEXT,
  ADD COLUMN IF NOT EXISTS "voice_config_json" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "soul_assets_metadata_on_chain_id_key"
  ON "soul_assets"("metadata_on_chain_id");
