## Goal

修复 `move/soulidity` 中已确认需要落地的两类问题：

1. `grant.move` 只允许已定义的 scope bit，拒绝未知权限位。
2. `skills.move` 消除 `SoulSkills.version_ids` 无界增长导致的共享根对象膨胀。

## Out Of Scope

- 不在本轮把 `import` / `personal join` 的 provenance 校验下沉到合约层。
- 不在本轮对 `memory.move` 做结构改造，除非实现过程中发现现有链路被 `skills` 改动直接影响。
- 不在本轮新增链下归档、分页 API 或 Walrus blob 保活机制。

## Constraints

- 允许修改 `skills.move` 数据结构。
- 要同步修正受影响的链下解析代码，不能留下运行时字段错配。
- 优先最小充分改动，不引入额外业务语义扩展。

## Acceptance

1. 发放 grant 时，任何超出 `SEAL | MEMORY | SKILLS` 的 bit 都会 abort。
2. `SoulSkills` 的共享根对象不再通过 `vector<ID>` 随版本数线性膨胀。
3. `sui move test --path move/soulidity` 通过。
4. 受影响的 `new-web` 链下对象解析与测试保持可运行，不再依赖旧的 `version_ids: vector<ID>` 语义。
