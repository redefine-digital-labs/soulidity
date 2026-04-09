# Collection Preview Loop Fix

## Goal

修复 `new-web/app/collections/create/preview/page.tsx` 在 Collection Launch Phase 3.3 成功态下触发的 `Maximum update depth exceeded`，并把 `create/import/wrap-link` 中相同的成功态 context 写回模式一并收口，确保成功页跳转只提交一次结果。

## Scope

- `new-web/app/collections/create/preview/page.tsx`
- `new-web/app/create/gas/page.tsx`
- `new-web/app/import/gas/page.tsx`
- `new-web/app/wrap-link/personal/preview/page.tsx`
- `tests/new-web/collection-publish-regressions.test.ts`
- `tests/new-web/success-effect-loop-regressions.test.ts`

## Acceptance

1. Collection preview 页成功态副作用不得依赖整个 `ctx` context 对象。
2. `create/import/wrap-link` 的成功态副作用也不得依赖整个 context 对象。
3. 成功态副作用即使在 context/provider 重新渲染时也只能提交一次结果，不得形成重复写回闭环。
4. 现有 Collection Phase 3.3 导航回归测试继续通过，并新增针对本次无限循环问题的回归保护。

## Plan

1. 先补最小失败测试，锁定 preview 成功态 effect 的依赖和一次性提交约束。
2. 再把 preview 页和同型成功态逻辑收口到稳定依赖，并增加一次性防重入保护。
3. 最后跑相关测试与 typecheck，确认不影响 create/import/collection/wrap 的成功页链路。
