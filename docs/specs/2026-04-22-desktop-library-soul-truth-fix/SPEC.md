# Desktop Library Soul Truth Fix

## Goal

修复 desktop app 的 Library 中 `My Souls` 和 `Browse Marketplace` 在 web 端已有 Soul 数据时仍显示为空的问题。desktop 的 Soul 数据必须回到 live `soul_assets` ownership + marketplace projection 作为真值，不能再被空的 `desktop_catalog_entries` 白名单截断。

## Scope

- `web/lib/desktop/repository.ts`
  为 Soul 增加动态 desktop catalog item / manifest 解析；starter 继续走显式 catalog entry。
- `web/app/api/desktop/catalog/[id]/route.ts`
  对动态 Soul manifest 增加 public-listed / authenticated-held 的访问边界。
- `web/app/api/desktop/me/souls/route.ts`
  桌面 owned Souls 读取继续走 ownership 真值，不因 catalog 白名单缺失返回空数组。
- `tests/new-web/desktop-catalog-*.test.ts`
  覆盖动态 listed Soul、owned Soul 和 held Soul manifest access 的回归测试。

## Acceptance

1. 当 `desktop_catalog_entries` 为空但存在 listed Soul 时，`/api/desktop/catalog` 仍返回这些 Soul 的 desktop marketplace items。
2. 当用户拥有 Soul 但该 Soul 不在 `desktop_catalog_entries` 时，`/api/desktop/me/souls` 仍返回 owned Soul items。
3. Desktop manifest / active persona 对 Soul source 的解析不再要求先写入 `desktop_catalog_entries`。
4. 动态 listed Soul manifest 仍可公开读取；动态 held / floor-violation Soul manifest 必须要求 desktop 身份并通过 Soul access 校验，不扩大公开 blast radius。
5. 相关 targeted tests 通过。
