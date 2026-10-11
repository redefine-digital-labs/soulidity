CREATE TABLE "login_challenges" (
    "token" TEXT NOT NULL,
    "tg_id" TEXT,
    "member_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_challenges_pkey" PRIMARY KEY ("token")
);

CREATE INDEX "login_challenges_member_id_idx" ON "login_challenges"("member_id");
CREATE INDEX "login_challenges_expires_at_idx" ON "login_challenges"("expires_at");

ALTER TABLE "login_challenges"
ADD CONSTRAINT "login_challenges_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "members"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
