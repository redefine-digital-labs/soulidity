1. 先补 Move / TS 红灯测试，覆盖未知 grant scope 拒绝和 `SoulSkills` 新结构解析。
2. 重构 `skills.move` 的版本索引存储，保持根对象常量大小。
3. 在 `grant.move` 增加 scope 白名单校验，并补齐相应错误码与测试。
4. 更新 `new-web/lib/soulidity/**` 对 `SoulSkills` 的对象解析与类型定义。
5. 运行 Move 测试与相关前端测试，确认通过后整理结论。
