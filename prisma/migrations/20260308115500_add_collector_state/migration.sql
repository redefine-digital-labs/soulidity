-- CreateTable
CREATE TABLE "collector_states" (
    "source" TEXT NOT NULL,
    "last_posted_at" TIMESTAMPTZ,
    "last_tweet_id" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collector_states_pkey" PRIMARY KEY ("source")
);
