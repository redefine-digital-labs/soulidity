# Auth Flow Redesign: Email OTP + Invite Code

> Date: 2026-03-15
> Branch: feat/auth-flow

## Summary

Remove Telegram login from Privy, switch to email OTP. Registration gated by invite code obtained through Telegram bot. Users must follow TG channel → add bot → paste skill text to OpenClaw agent → receive TG group invite + website registration link.

## Flows

### Registration

1. User follows TG channel → clicks button in channel message → adds bot
2. Bot sends skill guide text (contains tg_id + invite_code)
3. User pastes to OpenClaw Agent → Agent calls `POST /api/join`
4. Returns: TG group invite link + registration URL `/register?code=XXXX`
5. User opens registration link → validates invite code → enters email
6. Check email not already registered → Privy email OTP → verify
7. Backend: consume invite code + create Account (email, privyDid) + create Member
8. Registration complete

### Login

1. User visits `/login` → enters email
2. `GET /api/auth/check-email` → if not registered, show "请先通过邀请码注册"
3. If registered → trigger Privy email OTP → verify → logged in

### Invite Code Rules

- 10 minute expiry, single use
- Unregistered users can request new codes from bot repeatedly
- Registered users (tg_id has member with accountId) → bot refuses

### Bot Refusal Logic

```
/join command →
  Query: Member WHERE tgId = user.tg_id AND accountId IS NOT NULL
  → Found → Reply "你已注册，请直接登录网站"
  → Not found → Generate invite code + send skill text
```

## Technical Changes

### Privy Config

- `loginMethods: ['telegram']` → `['email']`
- Remove Telegram-related Privy callback logic
- Account matching: privyDid (no change for /api/auth/me)

### New Pages

- `/register?code=XXXX` — validate code → email input → Privy OTP → create account
- `/login` — rework: email input → check registered → Privy OTP

### New API Routes

- `GET /api/auth/check-email?email=x` — returns `{ registered: boolean }`
- `POST /api/register` — validate invite code + Privy token → create Account + Member
- `GET /api/register/validate-code?code=x` — check if invite code is valid

### Modified API Routes

- `POST /api/join` — add `register_url` to response (registration link with invite code)
- `POST /api/auth/privy-callback` — remove (replaced by /api/register)

### Modified Files

- `web/components/privy-provider.tsx` — change loginMethods to ['email']
- `web/components/auth-provider.tsx` — remove auto privy-callback, add register-aware logic
- `src/bot/handlers.ts` — add registered-user check, add register URL to response
- `web/middleware.ts` — add `/register` to public paths

### Data Model

- Account: already has email field (used by Privy), no schema change needed
- Member: inviteCode field already exists, no change
- InviteCode: no change

### Deletions

- Privy Telegram OAuth config
- `/api/auth/privy-callback` route (logic moves to /api/register)
- Telegram login UI components from login page

### Unchanged

- Agent claim flow (uses Privy email login session)
- Agent join flow (wallet signature, no Privy)
- Admin auth (Supabase, separate system)
- `resolveIdentity()` in identity.ts (Privy JWT path still works)

## Register Page Flow Detail

```
Page load → GET /api/register/validate-code?code=XXXX
  Invalid/expired → "邀请码无效，请重新从机器人获取"
  Valid → show email input

Enter email → GET /api/auth/check-email?email=x
  Already registered → "该邮箱已注册，请直接登录" + link to /login
  Not registered → trigger Privy email OTP

Privy OTP success → POST /api/register { code, privyToken }
  Backend: consume invite code → create Account → create Member
  → redirect to /community
```

## Auth Provider Changes

```
Before:
  Privy ready → /api/auth/me → no user → auto /api/auth/privy-callback(tgId match)

After:
  Privy ready → /api/auth/me →
    has user → normal login
    no user + on /register page → let register page handle creation
    no user + elsewhere → show "请先注册"
```
