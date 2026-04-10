# Open Registration Design

Remove the invite code requirement and allow users to register through two entry points: web (Privy email) and Telegram Bot — both without invite codes.

## Scope

- Delete the entire invite code system (model, generators, admin UI, API)
- Add auto-registration in `resolvePrivyIdentity()` for web-first users
- Simplify the Telegram Bot `/join` flow to skip invite code validation
- Clean up all related code, tests, and references

## Schema Changes

### Delete

- **`InviteCode` model** — drop `invite_codes` table entirely

### Modify

- **`Member` model**:
  - Remove `inviteCode` field and its `@@index([inviteCode])`
  - `tgId` remains `String?` (already optional) — web-registered users will have `tgId: null`

Migration: Prisma generates `DROP TABLE invite_codes` + `ALTER TABLE members DROP COLUMN invite_code` + drop index.

## Web Registration (auto-create)

**File**: `web/lib/auth/identity.ts` — `resolvePrivyIdentity()`

Current behavior: returns `null` when no Account/Member is found for a new Privy user.

New behavior: auto-create Account + Member when no match is found.

### Flow

```
Privy token verified (claims.userId extracted)
  → Search existing Account by: privyDid → tgId → email
  → Found → return Identity (existing logic, unchanged)
  → Not found → auto-create:
      1. prisma.$transaction:
         - Account.create { privyDid: claims.userId, email, tgName }
         - Member.create { accountId, kind: 'human' }
      2. ensureSuiWallet(claims.userId, member.id, privyUser)
      3. Return Identity { accountId, memberId, kind: 'human' }
```

### Edge Cases

- **Email unique conflict**: Use try/catch with `isUniqueConstraintError`, same pattern as existing legacy account linking (identity.ts:392).
- **Concurrent creation**: Transaction ensures atomicity. If two requests race, one succeeds and the other finds the just-created account on retry via the existing lookup path.
- **No tgId**: Web-registered Member has `tgId: null`. Can bind Telegram later via Bot.

## Bot Flow Simplification

### `handleJoin` (src/bot/handlers.ts)

Current: check existing member → check pending invite → create invite code + Member upsert → reply with invite code prompt.

New:
```
/join command received
  → member.accountId exists → reply "Already registered, go to {baseUrl}/login"
  → else → upsert Member { tgId, tgName }
         → create Telegram group invite link
         → reply with group link + website URL
```

No invite code generation, no invite code validation, no skill-based verification prompt.

### `processJoinRequest` (src/bot/gateway.ts)

**Delete entirely.** This function's core purpose is invite code validation + consumption, which is no longer needed. The simplified logic lives directly in `handleJoin`.

### Bot Reply Message

```
欢迎加入 OpenClaw！
1. 点击链接加入 Telegram 群：{群邀请链接}
2. 访问网站注册账号：{网站地址}
```

## Cleanup

### Delete Files

| File | Reason |
|------|--------|
| `src/shared/invite-code-generator.ts` | Invite code generation |
| `src/shared/invite-code-record.ts` | Invite code DB insertion |
| `src/shared/invite-code-format.ts` | Invite code format validation |
| `web/app/api/admin/invites/route.ts` | Admin invite API |
| `web/app/admin/invites/page.tsx` | Admin invite UI page |
| `src/bot/gateway.ts` | `processJoinRequest` — entire file is this one function |

### Modify Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Remove `InviteCode` model, remove `Member.inviteCode` field + index |
| `web/lib/auth/identity.ts` | Add auto-create logic at end of `resolvePrivyIdentity()` |
| `src/bot/handlers.ts` | Simplify `handleJoin`, remove `buildJoinPrompt`, remove `createInviteCodeRecord` import |
| `src/db/members.ts` | Delete `createInviteCode`, `validateInviteCode`, `useInviteCode`; remove `inviteCode` param from `insertMember` |
| `web/app/admin/layout.tsx` | Remove "邀请码" from `adminNav` array |

### Test Files

| File | Action |
|------|--------|
| `tests/web/join-api.test.ts` | Delete (tests `processJoinRequest` invite logic) |
| `tests/web/join-route.test.ts` | Update or delete |
| `tests/db/members.test.ts` | Remove invite code test cases |
| `tests/bot/handlers.test.ts` | Update `handleJoin` tests for new flow |
| `tests/helpers/mock-prisma.ts` | Remove `inviteCode` mock fields |

### Not Touched

- `docs/plans/` and `docs/legacy/` — historical documentation, no runtime impact
- Migration SQL files in `prisma/migrations/` — immutable history

## Anti-Spam

No additional anti-spam measures for now. Privy's built-in email verification serves as the registration gate. Can add rate limiting later if needed.

## Acceptance Criteria

1. New user can register on the web by logging in with Privy (email) — Account + Member auto-created
2. New user can `/join` via Telegram Bot without an invite code — Member created, group invite link returned
3. `InviteCode` table is dropped, `Member.inviteCode` column is removed
4. All invite-related code, admin pages, and API routes are deleted
5. No references to invite code logic remain in runtime code
6. Existing tests pass (updated or removed as needed); new tests cover the auto-create path
7. `npm test` passes
