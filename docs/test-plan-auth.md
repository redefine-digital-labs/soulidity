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

### Preserved (TG bot references for invite codes — NOT login):
- `register/page.tsx` — "Telegram 机器人" for getting invite codes
- `login/page.tsx` — `t.me/CryptoOpenclaw` link for invite codes
- "未找到账号" section — TG channel instructions for getting invite codes
