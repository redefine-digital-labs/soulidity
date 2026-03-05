-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "pipeline_status" TEXT NOT NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE "agent_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "agent_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_process_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "article_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" TEXT,
    "output" TEXT,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_process_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_roles_name_key" ON "agent_roles"("name");

-- CreateIndex
CREATE INDEX "agent_process_logs_article_id_idx" ON "agent_process_logs"("article_id");

-- CreateIndex
CREATE INDEX "agent_process_logs_status_idx" ON "agent_process_logs"("status");

-- AddForeignKey
ALTER TABLE "agent_process_logs" ADD CONSTRAINT "agent_process_logs_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_process_logs" ADD CONSTRAINT "agent_process_logs_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "agent_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
