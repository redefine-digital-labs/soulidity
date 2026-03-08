# 互动化反馈（TG 社群 + OpenClaw 验证入群）设计

**日期**: 2026-03-08
**状态**: 已确认

---

## 决策记录

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 验证方式 | 邀请码（现有 InviteCode） | 链上合约未上线，先跑通流程 |
| 部署架构 | 统一进程，Bot 长驻 main.ts | 消息量小，无需拆分 |
| 入群流程 | Bot → prompt → OpenClaw skill → HTTP API → 邀请链接 | 用 OpenClaw 自身作为验证媒介 |
| 群内身份 | MVP 不做 | 先跑通入群，身份标签后续迭代 |
| 内容反哺 | /mark 命令标记群消息入 raw_items | 管理员手动标记，简单有效 |

---

## 整体架构

```
┌─────────────────────────────────────┐
│          Bot (长驻 main.ts)          │
│                                     │
│  /join  → 返回 prompt + skill 链接   │
│  /mark  → 标记群消息存入 raw_items   │
│  /start → 欢迎语                    │
└──────────────┬──────────────────────┘
               │
               │  用户复制 prompt → 发给 OpenClaw
               │  OpenClaw 执行 join-skill.md
               │
               ▼
┌─────────────────────────────────────┐
│     POST /api/join                  │
│     - 验证 tg_id + invite_code      │
│     - 消费邀请码                     │
│     - 创建/更新 Member              │
│     - Bot API 生成一次性邀请链接      │
│     - 返回 invite_link              │
└─────────────────────────────────────┘
```

---

## /join 命令

用户私聊 Bot 发送 `/join`，Bot 回复包含：
1. 欢迎文案
2. 预组装的 prompt（内嵌用户 tg_id）
3. 指导用户复制 prompt 发给 OpenClaw

Bot 回复示例：

```
🦞 欢迎加入 OpenClaw 社群！

请将以下内容复制发送给你的 OpenClaw Agent：

---
请执行以下 skill 帮我加入 OpenClaw 社群：
https://raw.githubusercontent.com/.../join-skill.md

我的验证信息：
- tg_id: 123456789
- 请向我索要邀请码
---
```

---

## join-skill.md

skill 指导 OpenClaw Agent：
1. 向用户索要邀请码
2. 调用 `POST https://clawnews-mu.vercel.app/api/join`，body: `{ tg_id, invite_code }`
3. 成功 → 展示返回的 `invite_link`
4. 失败 → 展示错误信息

---

## POST /api/join 接口

```
POST /api/join
Content-Type: application/json

Request:  { "tg_id": "123456789", "invite_code": "A1B2C3D4" }
Success:  { "success": true, "invite_link": "https://t.me/+aBcDeFgHiJk" }
Failure:  { "success": false, "error": "Invalid or used invite code" }
```

服务端逻辑：
1. 校验 tg_id + invite_code 非空
2. 查询 InviteCode：code 匹配、active=1、usedBy=null
3. 失败 → 返回错误
4. 成功 → 事务内：消费邀请码 → Upsert Member → Bot API createChatInviteLink (member_limit=1, 10分钟过期)
5. 返回 invite_link

---

## /mark 命令（内容反哺）

管理员在群内回复某条消息并发送 `/mark`：
1. 检查发送者是群管理员
2. 检查是否回复消息
3. 提取被回复消息文本
4. 插入 raw_items：source_type="community", source_name="tg_group", score=5.0
5. url 使用 `tg://msg/{group_id}/{message_id}` 作为唯一标识
6. Bot 回复 "✅ 已标记为素材"

---

## Bot 长驻改造

当前 bot 只在发布时临时创建。改为长驻 long-polling：

- `src/bot/handlers.ts` — 注册 /join, /mark, /start 命令
- `src/bot/gateway.ts` — 邀请链接生成逻辑
- `src/main.ts` — 启动 bot.start()，共享 bot 实例给 publisher

---

## 文件变更

**新增：**
- `src/bot/handlers.ts` — 命令处理
- `src/bot/gateway.ts` — 邀请链接逻辑
- `data/join-skill.md` — OpenClaw skill
- `web/app/api/join/route.ts` — HTTP 接口

**改动：**
- `src/main.ts` — 启动 Bot long-polling
- `src/publisher/bot.ts` — 共享 bot 实例
- `src/publisher/publish.ts` — 适配共享 bot
- `src/scheduler.ts` — 适配共享 bot

**新增环境变量：**
- `TG_GROUP_ID` — 目标群 chat ID
