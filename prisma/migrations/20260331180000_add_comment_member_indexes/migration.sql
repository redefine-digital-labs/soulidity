-- CreateIndex
CREATE INDEX "comments_member_id_idx" ON "comments"("member_id");

-- CreateIndex
CREATE INDEX "comments_member_id_is_accepted_idx" ON "comments"("member_id", "is_accepted");
