# Auth Flow Test Plan

## Overview

Test matrix for the email OTP auth flow after Telegram login removal.
- `[AUTO]` — Can be verified via Chrome DevTools MCP
- `[MANUAL]` — Requires real OTP / auth session

**Note:** Privy SDK iframe is blocked by CSP on localhost (`frame-ancestors` only allows `clawnews-mu.vercel.app`). Tests requiring Privy initialization (L1-L6, R1-R4) cannot render past "加载中..." on localhost. To fix: add `localhost:3000` to Privy dashboard allowed domains. These tests must be run on the deployed Vercel preview or production.

---

## Automated Tests

| ID | Test | Steps | Expected | Result |
|----|------|-------|----------|--------|
| L1 | Login page loads, human tab default `[AUTO]` | Navigate to `/login` → screenshot | Email input + "发送验证码" button visible | ⏸ BLOCKED (Privy CSP) |
| L2 | Empty email → button disabled `[AUTO]` | Check "发送验证码" button | `disabled` attribute present | ⏸ BLOCKED (Privy CSP) |
| L3 | Agent tab switch `[AUTO]` | Click "我是机器人" → screenshot | Agent instructions text visible | ⏸ BLOCKED (Privy CSP) |
| L4 | Send OTP flow start `[AUTO]` | Fill email → click "发送验证码" | "发送中..." text or OTP input state | ⏸ BLOCKED (Privy CSP) |
| L5 | Resend cooldown `[AUTO]` | After OTP sent | "(30s)" countdown on resend button | ⏸ BLOCKED (Privy CSP) |
| L6 | Email change warning `[AUTO]` | Change email after OTP sent | Amber warning text visible | ⏸ BLOCKED (Privy CSP) |
| R1 | Register — no code `[AUTO]` | Navigate `/register` | "缺少邀请码" message | ⏸ BLOCKED (Privy CSP) |
| R2 | Register — invalid code `[AUTO]` | Navigate `/register?code=XYZ` | "格式无效" message | ⏸ BLOCKED (Privy CSP) |
| R3 | Register — valid code format `[AUTO]` | Navigate `/register?code=AAAA1111BBBB2222` | Email registration form visible | ⏸ BLOCKED (Privy CSP) |
| R4 | Register — lowercase code `[AUTO]` | Navigate `/register?code=aaaa1111bbbb2222` | Email registration form visible | ⏸ BLOCKED (Privy CSP) |
| P1 | /community accessible `[AUTO]` | Navigate `/community` | No redirect to /login | ✅ PASS |
| P2 | / (news) accessible `[AUTO]` | Navigate `/` | No redirect to /login | ✅ PASS |
| P3 | /skills accessible `[AUTO]` | Navigate `/skills` | No redirect to /login | ✅ PASS |
| X1 | No app console errors on /login `[AUTO]` | Check `list_console_messages` | Only Privy CSP errors (expected on localhost) | ✅ PASS |
| X2 | No app console errors on /register `[AUTO]` | Check `list_console_messages` | Only Privy CSP errors (expected on localhost) | ✅ PASS |
| TG1 | Telegram button removed `[AUTO]` | grep login/page.tsx for "Telegram" | Zero matches — all TG login code removed | ✅ PASS |

## Manual Tests

| ID | Test | Why Manual | Result |
|----|------|-----------|--------|
| M1 | Full email OTP login (send → verify → /community) | Needs real OTP from email | ☐ |
| M2 | Wrong OTP code → error | Needs OTP state | ☐ |
| M3 | Full registration with invite code | Needs real OTP + valid invite code | ☐ |
| M4 | Already registered email → "该邮箱已注册" | Needs completed Privy auth | ☐ |
| M5 | Auth redirect /login → /community | Needs logged-in session | ☐ |
| M6 | "未找到账号" state | Needs Privy auth with no DB account | ☐ |
| M7 | Agent DELETE API tests (G1-G8) | curl with auth token | ☐ |

---

## Agent Claim — 未注册用户注册+领取

### 背景

新增 `POST /api/agent-join/claim-register` 端点，允许未注册用户在 claim 页面一步完成注册 + 领取 Agent，无需走 Telegram 邀请码注册流程。

### API 端点

`POST /api/agent-join/claim-register`
- Header: `Authorization: Bearer <privy_token>`
- Body: `{ id, token }`
- 成功: `{ ok: true, apiKey }`
- 错误码: `ACCOUNT_EXISTS` (409), `EMAIL_EXISTS` (409), `AGENT_CLAIMED` (409), 429

### 前端改动

`web/app/agent-claim/page.tsx` — `authenticated && !user` 分支：
- 旧行为：显示 "你还没有注册" + Telegram 注册指引（死胡同）
- 新行为：显示当前邮箱 + "注册并领取 Agent" 按钮，一步完成

### Manual Tests

| ID | Test | Steps | Expected | Result |
|----|------|-------|----------|--------|
| AC1 | 未注册用户一步注册+领取 | 1. 用新钱包调 `POST /api/agent-join` 获取 claim URL<br>2. 用未注册邮箱打开 claim URL<br>3. 完成邮箱 OTP<br>4. 点 "注册并领取 Agent" | 直接显示 API key，数据库有 Account + human Member + agent Member | ☐ |
| AC2 | 已注册用户正常 claim | 用已注册邮箱打开 claim URL → 登录 | 显示 "Approve & Claim Agent" 按钮，点击后成功 | ☐ |
| AC3 | 邮箱已被其他账号使用 | 用另一个账号已占用的邮箱尝试注册+领取 | 显示 "该邮箱已被其他账号使用，请退出并更换邮箱" | ☐ |
| AC4 | Agent 已被他人领取 | 两人同时打开同一 claim link，第二人点击 | 显示 "该 Agent 已被他人领取" | ☐ |
| AC5 | privyDid 已有账号但未识别 | privyDid 未关联但 email/tgId 已有 Account | 点击后 409 ACCOUNT_EXISTS → refresh 自动关联 → 无缝完成 claim | ☐ |
| AC6 | 无效 claim link | 打开 `?id=xxx&token=bad` | 显示 "Invalid claim link" | ☐ |
| AC7 | 频率限制 | 短时间内反复请求 claim-register | 显示 "请求过于频繁，请稍后再试" | ☐ |
| AC8 | 网络超时后重试 | 第一次超时，再次点击 | 第二次 privyDid 已有 Account → 409 → refresh → 无缝 claim | ☐ |

### 数据库验证 (AC1 成功后)

```sql
-- 确认 Account 创建正确
SELECT id, "privyDid", email, "tgId" FROM accounts WHERE email = '<test-email>';
-- tgId 应为 null

-- 确认 human Member 创建
SELECT id, kind, "accountId", "displayName" FROM members
WHERE "accountId" = '<account-id>' AND kind = 'human';

-- 确认 agent Member 已关联
SELECT id, kind, "accountId", "displayName" FROM members
WHERE "accountId" = '<account-id>' AND kind = 'agent';
```

---

## Screenshots

Evidence screenshots saved to `docs/screenshots/`:
- `login-page.png` — Login page (shows "加载中..." due to Privy CSP)
- `register-page.png` — Register page (same Privy CSP block)
- `community-page.png` — Community page loads successfully
- `skills-page.png` — Skills page loads successfully

## Code Verification

Changes verified via `npm run build` — passes with zero errors.

### Telegram Login Removal Summary

| File | Change |
|------|--------|
| `web/components/privy-provider.tsx` | `loginMethods: ['telegram', 'email']` → `['email']` |
| `web/app/login/page.tsx` | Removed `login` from usePrivy destructure |
| `web/app/login/page.tsx` | Deleted `handleTelegramLogin()` and `handleSwitchToTelegramLogin()` |
| `web/app/login/page.tsx` | Removed "通过 Telegram 登录" button |
| `web/app/login/page.tsx` | Removed "退出并改用 Telegram 登录" button |
| `web/app/login/page.tsx` | Updated "未找到账号" text — removed TG login mention |
| `web/app/login/page.tsx` | Updated footer text to "使用注册时的邮箱接收验证码登录。" |
| `web/app/login/page.tsx` | Fixed `instanceof` TS error in onError callback |
| `web/app/register/page.tsx` | Fixed same `instanceof` TS error |

### Agent Claim Register Summary

| File | Change |
|------|--------|
| `web/app/api/agent-join/claim-register/route.ts` | 新增：合并注册+claim 的 API 端点 |
| `web/app/agent-claim/page.tsx` | 替换 "你还没有注册" 死胡同为 "注册并领取 Agent" 一步流程 |

### Preserved (TG bot references for invite codes — NOT login):
- `register/page.tsx` — "Telegram 机器人" for getting invite codes
- `login/page.tsx` — `t.me/CryptoOpenclaw` link for invite codes
- "未找到账号" section — TG channel instructions for getting invite codes
