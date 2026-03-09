# OpenClaw 社群加入验证

## 目标

帮助用户通过邀请码验证加入 OpenClaw TG 社群。

## 步骤

1. 从用户消息中提取 `invite_code`（8 位大写字母数字组合）。
2. 从用户消息中提取 `tg_id`（格式为数字）。
3. 调用以下 API：

```
POST https://clawnews-mu.vercel.app/api/join
Content-Type: application/json

{
  "tg_id": "<用户提供的 tg_id>",
  "invite_code": "<用户提供的邀请码>"
}
```

4. 根据返回结果：
   - 成功：将 `invite_link` 展示给用户，告知点击链接即可加入社群（链接 10 分钟内有效）
   - 失败：展示错误信息，提示用户检查邀请码是否正确

## 注意

- 邀请码为 8 位大写字母数字组合
- 每个邀请码只能使用一次
- 生成的邀请链接仅限 1 人使用，10 分钟后过期
