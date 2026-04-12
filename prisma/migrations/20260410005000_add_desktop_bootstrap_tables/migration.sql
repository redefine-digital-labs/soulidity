BEGIN;

CREATE TABLE IF NOT EXISTS "starter_persona_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "cover_image" TEXT NOT NULL,
  "thumbnail" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "files" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "starter_persona_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "starter_persona_assets_slug_key"
  ON "starter_persona_assets"("slug");

CREATE INDEX IF NOT EXISTS "starter_persona_assets_updated_at_idx"
  ON "starter_persona_assets"("updated_at" DESC);

CREATE TABLE IF NOT EXISTS "desktop_catalog_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_type" TEXT NOT NULL,
  "source_ref" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_published" BOOLEAN NOT NULL DEFAULT true,
  "is_hidden" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "desktop_catalog_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "desktop_catalog_entries_source_type_check"
    CHECK ("source_type" IN ('starter', 'soul'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "desktop_catalog_entries_source_type_source_ref_key"
  ON "desktop_catalog_entries"("source_type", "source_ref");

CREATE INDEX IF NOT EXISTS "desktop_catalog_entries_is_published_is_hidden_sort_order_idx"
  ON "desktop_catalog_entries"("is_published", "is_hidden", "sort_order");

CREATE INDEX IF NOT EXISTS "desktop_catalog_entries_source_type_sort_order_idx"
  ON "desktop_catalog_entries"("source_type", "sort_order");

CREATE TABLE IF NOT EXISTS "desktop_device_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID,
  "device_code" TEXT NOT NULL,
  "user_code" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "poll_interval_seconds" INTEGER NOT NULL DEFAULT 5,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "confirmed_at" TIMESTAMPTZ,
  "last_polled_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "desktop_device_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "desktop_device_sessions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "desktop_device_sessions_status_check"
    CHECK ("status" IN ('pending', 'confirmed', 'consumed', 'expired')),
  CONSTRAINT "desktop_device_sessions_poll_interval_seconds_check"
    CHECK ("poll_interval_seconds" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "desktop_device_sessions_device_code_key"
  ON "desktop_device_sessions"("device_code");

CREATE UNIQUE INDEX IF NOT EXISTS "desktop_device_sessions_user_code_key"
  ON "desktop_device_sessions"("user_code");

CREATE INDEX IF NOT EXISTS "desktop_device_sessions_status_expires_at_idx"
  ON "desktop_device_sessions"("status", "expires_at");

CREATE INDEX IF NOT EXISTS "desktop_device_sessions_account_id_updated_at_idx"
  ON "desktop_device_sessions"("account_id", "updated_at" DESC);

CREATE TABLE IF NOT EXISTS "desktop_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "active_source_type" TEXT,
  "active_source_ref" TEXT,
  "preferences" JSONB,
  "last_synced_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "desktop_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "desktop_profiles_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "desktop_profiles_account_id_key"
  ON "desktop_profiles"("account_id");

CREATE INDEX IF NOT EXISTS "desktop_profiles_active_source_type_active_source_ref_idx"
  ON "desktop_profiles"("active_source_type", "active_source_ref");

COMMIT;
