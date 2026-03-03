-- CreateTable
CREATE TABLE "raw_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_type" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title_hash" TEXT,
    "content" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'new',
    "raw_data" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "raw_item_id" UUID NOT NULL,
    "title_zh" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "summary_zh" TEXT NOT NULL,
    "summary_en" TEXT NOT NULL,
    "analysis_zh" TEXT,
    "analysis_en" TEXT,
    "tags" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "website" TEXT,
    "logo_url" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "mention_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_companies" (
    "article_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,

    CONSTRAINT "article_companies_pkey" PRIMARY KEY ("article_id","company_id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "article_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "message_id" TEXT,
    "published_at" TIMESTAMPTZ,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tg_id" TEXT NOT NULL,
    "tg_name" TEXT,
    "wallet" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "invite_code" TEXT,
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite_codes" (
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_by" TEXT,
    "active" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "invite_codes_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "raw_items_url_key" ON "raw_items"("url");

-- CreateIndex
CREATE INDEX "raw_items_status_idx" ON "raw_items"("status");

-- CreateIndex
CREATE INDEX "raw_items_score_idx" ON "raw_items"("score" DESC);

-- CreateIndex
CREATE INDEX "raw_items_created_at_idx" ON "raw_items"("created_at");

-- CreateIndex
CREATE INDEX "articles_status_idx" ON "articles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE INDEX "companies_category_idx" ON "companies"("category");

-- CreateIndex
CREATE INDEX "companies_mention_count_idx" ON "companies"("mention_count" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "members_tg_id_key" ON "members"("tg_id");

-- CreateIndex
CREATE INDEX "members_tg_id_idx" ON "members"("tg_id");

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_raw_item_id_fkey" FOREIGN KEY ("raw_item_id") REFERENCES "raw_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_companies" ADD CONSTRAINT "article_companies_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_companies" ADD CONSTRAINT "article_companies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
