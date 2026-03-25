-- Add seal_sidecar to soul_releases for Seal envelope encryption metadata
ALTER TABLE "soul_releases" ADD COLUMN IF NOT EXISTS "seal_sidecar" JSONB;
