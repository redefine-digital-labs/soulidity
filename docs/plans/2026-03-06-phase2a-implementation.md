# Phase 2a: 养成社区

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a community system where users post growth logs, comment, earn achievements, and view profiles. Extend the existing Member model with avatar/bio/exp fields.

**Architecture:** New Prisma models (Post, Comment, Achievement, MemberAchievement). Community pages under `/community`, user profiles under `/u/[id]`. API routes for CRUD.

**Tech Stack:** Prisma, Next.js 16 App Router, TailwindCSS

---

## Task 1: Extend Member model and add Post/Comment/Achievement models

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/shared/types.ts`
- Modify: `tests/helpers/mock-prisma.ts`

Add fields to Member: `avatar String?`, `bio String?`, `exp Int @default(0)`.
Add relations: `posts Post[]`, `comments Comment[]`, `achievements MemberAchievement[]`.

New models:

```prisma
model Post {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  memberId     String    @map("member_id") @db.Uuid
  member       Member    @relation(fields: [memberId], references: [id])
  directionId  String?   @map("direction_id") @db.Uuid
  direction    Direction? @relation(fields: [directionId], references: [id])
  title        String
  content      String
  tags         String?
  likeCount    Int       @default(0) @map("like_count")
  commentCount Int       @default(0) @map("comment_count")
  status       String    @default("published")
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz
  comments     Comment[]

  @@index([memberId])
  @@index([directionId])
  @@index([createdAt])
  @@map("posts")
}

model Comment {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  postId    String   @map("post_id") @db.Uuid
  post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  memberId  String   @map("member_id") @db.Uuid
  member    Member   @relation(fields: [memberId], references: [id])
  content   String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@index([postId])
  @@map("comments")
}

model Achievement {
  id          String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name        String              @unique
  nameZh      String              @map("name_zh")
  description String?
  icon        String              @default("🏆")
  condition   String?
  members     MemberAchievement[]

  @@map("achievements")
}

model MemberAchievement {
  memberId      String      @map("member_id") @db.Uuid
  member        Member      @relation(fields: [memberId], references: [id])
  achievementId String      @map("achievement_id") @db.Uuid
  achievement   Achievement @relation(fields: [achievementId], references: [id])
  earnedAt      DateTime    @default(now()) @map("earned_at") @db.Timestamptz

  @@id([memberId, achievementId])
  @@map("member_achievements")
}
```

Also add `posts Post[]` relation to Direction model.

Update mock-prisma with posts, comments, achievements, memberAchievements arrays.

Run `npx prisma generate`, run tests, commit.

---

## Task 2: Create community API routes

**Files:**
- Create: `web/app/api/community/posts/route.ts` — GET list (with filter by direction), POST create
- Create: `web/app/api/community/posts/[id]/route.ts` — GET single post with comments
- Create: `web/app/api/community/posts/[id]/comments/route.ts` — POST add comment
- Create: `web/app/api/community/profile/[id]/route.ts` — GET member profile with posts and achievements

Posts GET supports: `?direction=slug`, `?sort=latest|popular`, returns posts with member and direction info.
Posts POST expects: `{ memberId, directionId?, title, content, tags? }`.
Comments POST expects: `{ memberId, content }`.
Profile GET returns: member info + recent posts + achievements.

Commit after creating all routes.

---

## Task 3: Build community homepage `/community`

**Files:**
- Create: `web/app/community/page.tsx`
- Modify: `web/components/public-nav.tsx` — add Community link

Client page showing:
- Direction filter tabs (fetches from `/api/categories` for direction groups)
- Post list from `/api/community/posts` — each card shows: member avatar/name, post title, content preview, direction tag, likeCount, commentCount, time
- Link to `/community/new` for posting
- Each post links to `/community/[id]`

---

## Task 4: Build post creation page `/community/new`

**Files:**
- Create: `web/app/community/new/page.tsx`

Client page with form:
- Title input
- Content textarea
- Direction selector dropdown (fetches directions)
- Tags input
- Submit button → POST to `/api/community/posts`
- Redirect to `/community/[id]` on success

For MVP, use a hardcoded memberId or the first member in DB. Auth integration comes later.

---

## Task 5: Build post detail page `/community/[id]`

**Files:**
- Create: `web/app/community/[id]/page.tsx`

Server component that:
- Fetches post with comments from prisma
- Shows full post content, member info, direction tag, timestamps
- Lists comments with member name and time
- Has a comment form at bottom (POST to `/api/community/posts/[id]/comments`)

---

## Task 6: Build user profile page `/u/[id]`

**Files:**
- Create: `web/app/u/[id]/page.tsx`

Server component that:
- Fetches member from prisma with posts, achievements
- Shows: avatar placeholder, tgName, bio, level badge (Lv.1-5 with emoji), exp
- Achievement badges section
- Recent posts list
- Member stats (post count, total likes)

Level display mapping:
- Lv.1: 🥚 孵化中
- Lv.2: 🦐 初蜕壳
- Lv.3: 🦞 成长期
- Lv.4: 🦞🦞 达人
- Lv.5: 🦞🦞🦞 导师

---

## Task 7: Seed achievements and verify build

**Files:**
- Create: `src/db/seed-achievements.ts`

Seed default achievements:
- first-post: 🌱 首次发布 — 发布第一篇养成日志
- streak-7: 🔥 连续7天 — 连续7天发布日志
- streak-30: 💪 坚持30天 — 连续30天发布日志
- helper: 🤝 热心助人 — 帮助他人解答10个问题
- popular: ⭐ 人气之星 — 单篇日志获得50个赞
- expert: 🎓 方向达人 — 某方向被评为优质贡献者
- mentor: 👨‍🏫 社区导师 — 社区贡献突出获得导师认证

Add `"seed:achievements": "tsx src/db/seed-achievements.ts"` to package.json.

Run all tests, build frontend, tag `v0.3.0-phase2a`.
