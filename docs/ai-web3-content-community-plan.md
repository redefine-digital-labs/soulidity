# AI×Web3 内容社区体系搭建方案

## 整体架构：四步闭环

```
采集 → 制作 → 分发(TG频道) → 反馈(TG社群)
 ↑                                    |
 └────────── 反馈驱动选题 ─────────────┘
```

---

## 一、自动化采集

### 数据源矩阵

| 优先级 | 数据源 | 采集方式 | 频率 |
|--------|--------|----------|------|
| P0 | OpenClaw 生态动态 | API/链上事件监听 | 实时 |
| P0 | Twitter/X (AI×Web3 KOL) | 列表监控 + RSS | 每小时 |
| P1 | GitHub trending (AI Agent 相关) | GitHub API | 每日 |
| P1 | 链上数据 (Sui/ETH/Solana) | RPC + Indexer | 实时 |
| P2 | Arxiv / HuggingFace | RSS + API | 每日 |
| P2 | CoinDesk/TheBlock/Decrypt | RSS | 每小时 |

### 技术实现

```
采集引擎 (Node.js/Python Worker)
├── RSS Aggregator (feedparser)
├── Twitter List Monitor (API v2)
├── GitHub Trending Scraper
├── On-chain Event Listener (Sui SDK / ethers.js)
└── 去重 + 评分排序 → 素材库 (Supabase/PostgreSQL)
```

### 评分机制

按相关度（AI×Web3交叉度）、时效性、信源权威度加权打分，高分素材优先进入制作流程。

---

## 二、专业化制作

### 内容模板标准化

```markdown
# 📰 [标题：一句话概括核心信息]

**信源：** [原始链接] | **时间：** [发布时间]
**标签：** #AI Agent #OpenClaw #Sui

## 核心要点
[3-5 句中文摘要，确保专业准确]

## 深度解读
[结合 OpenClaw 生态的关联分析]

## 行动建议
[对社区成员的实际指引]

---
*由 OpenClaw 内容引擎生成，经人工审核*
```

### 制作流程

1. **AI 初稿** — Claude API 对素材做中文摘要 + 深度解读
2. **知识库关联** — 自动匹配 OpenClaw 代码库/文档中的相关模块，标注"可覆盖技能"
3. **人工审核** — 核心成员 5 分钟过一遍，确认准确性
4. **技能沉淀** — 审核通过的内容结构化存入 OpenClaw 的成长技能树

```
素材库 → Claude API (制作) → 审核队列 → [通过] → 发布队列 + 技能库
                                       → [打回] → 标注问题，反馈优化 prompt
```

---

## 三、渠道化分发（Telegram 频道）

### 频道设计

- **主频道** `@OpenClawDaily` — 每日精选 3-5 条深度内容
- **快讯频道** `@OpenClawFlash` — 实时推送重要动态（可选）

### 发布节奏

| 时段 | 内容类型 | 示例 |
|------|---------|------|
| 早 9:00 | 🌅 晨报摘要 | 过去24h AI×Web3 大事件 |
| 午 12:00 | 🔬 深度解读 | 技术分析/项目拆解 |
| 晚 20:00 | 🦞 OpenClaw 生态周报/日报 | 新技能、新集成、社区动态 |

### 技术实现

使用 Telegram Bot API (`grammy`) 定时发布，内容从审核通过的发布队列中拉取。

---

## 四、互动化反馈（TG 社群 + OpenClaw 验证入群）

### 🦞 核心创意：MoltBook + 人类 社交群组

> "验证你真的有🦞才能加的群"

### 入群流程

```
用户发现频道内容 → 想加入讨论群
        ↓
点击 "申请加入" 按钮
        ↓
Bot 引导：请通过 OpenClaw 验证身份
        ↓
┌─────────────────────────────────┐
│  OpenClaw 验证流程               │
│  1. 连接钱包                     │
│  2. 验证持有 OpenClaw Agent/NFT  │
│  3. 或：完成 OpenClaw 入门任务    │
│  4. 签名证明（防伪造）            │
└─────────────────────────────────┘
        ↓
验证通过 → Bot 自动邀请进群
验证失败 → 引导去 OpenClaw 注册/领取
```

### 技术实现方案

#### 1. Telegram Bot（入群网关）

```typescript
// 核心逻辑伪代码
import { Bot, InlineKeyboard } from "grammy";

const bot = new Bot(process.env.TG_BOT_TOKEN);

// 用户请求加群
bot.command("join", async (ctx) => {
  const keyboard = new InlineKeyboard()
    .url("🦞 通过 OpenClaw 验证", 
         `https://verify.openclaw.ai?tg_id=${ctx.from.id}&callback=tg`);
  
  await ctx.reply(
    "欢迎！本群仅限 OpenClaw 持有者加入 🦞\n请完成验证：",
    { reply_markup: keyboard }
  );
});

// 验证回调（OpenClaw 服务端调用）
app.post("/api/verify-callback", async (req, res) => {
  const { tg_id, wallet, verified, claw_level } = req.body;
  
  if (verified) {
    // 生成一次性邀请链接
    const invite = await bot.api.createChatInviteLink(GROUP_ID, {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + 600, // 10分钟过期
    });
    
    await bot.api.sendMessage(tg_id, 
      `✅ 验证通过！你的🦞等级：${claw_level}\n` +
      `点击加入：${invite.invite_link}`
    );
    
    // 记录映射：tg_id ↔ wallet
    await db.save({ tg_id, wallet, claw_level, joined_at: new Date() });
  }
});
```

#### 2. OpenClaw 验证服务

```typescript
// 验证逻辑
async function verifyClaw(wallet: string): Promise<VerifyResult> {
  // 方案 A：链上查询（如果 OpenClaw 是链上资产）
  const balance = await suiClient.getOwnedObjects({
    owner: wallet,
    filter: { StructType: "openclaw::agent::ClawAgent" }
  });
  
  // 方案 B：OpenClaw API 查询
  const clawStatus = await openclawAPI.getUserStatus(wallet);
  
  return {
    verified: balance.data.length > 0 || clawStatus.active,
    claw_level: clawStatus.level, // 🦞等级
    skills: clawStatus.skills,     // 已掌握技能
  };
}
```

#### 3. 群内身份体系

验证通过后，Bot 在群内为用户设置身份标签：

```
🦞 新蜕壳   — 刚加入，OpenClaw 初级
🦞🦞 成长中  — 完成 3+ 技能
🦞🦞🦞 老龙虾 — 核心贡献者
```

Bot 可以定期同步 OpenClaw 链上数据，自动升级用户角色。

### 群内运营规则

- **纯人类交流** — Bot 只负责验证和管理，不参与讨论
- **内容反哺** — 群内高质量讨论由管理员标记 → 进入采集池 → 形成新内容
- **共创机制** — 成员可以在群内提议 OpenClaw 新技能/新内容方向 → 投票 → 纳入制作计划

---

## 五、完整闭环数据流

```
                    ┌──────────────┐
                    │  素材库       │
                    │  (Supabase)  │
                    └──────┬───────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
     ┌────────────────┐      ┌──────────────────┐
     │ 自动采集 Worker │      │ 社群讨论 → 选题   │
     │ (RSS/API/链上)  │      │ (反馈闭环)        │
     └────────────────┘      └──────────────────┘
                                       ▲
              ┌────────────────┐       │
              │ Claude API 制作 │       │
              │ + 人工审核      │       │
              └───────┬────────┘       │
                      ▼                │
              ┌────────────────┐       │
              │ TG 频道 分发    │───────┘
              │ @OpenClawDaily │  用户从频道→社群
              └────────────────┘
                      │
                      ▼
              ┌────────────────┐
              │ OpenClaw 技能库 │  内容沉淀为 Agent 技能
              └────────────────┘
```

---

## 六、MVP 优先级建议

| 阶段 | 任务 | 时间 |
|------|------|------|
| **Week 1** | TG Bot 搭建 + OpenClaw 验证入群 | 3-5天 |
| **Week 2** | 采集引擎 MVP（3-5个核心数据源） | 3-5天 |
| **Week 3** | Claude API 内容制作 pipeline | 3天 |
| **Week 4** | 定时发布 + 频道上线 + 社群运营启动 | 2天 |

### 技术栈

- **Bot**: `grammy` (TypeScript)
- **后端**: Node.js + Supabase
- **采集**: Python workers (feedparser + requests)
- **AI 制作**: Claude API (Sonnet)
- **验证**: Sui SDK / OpenClaw API

---

## 七、候选项目名称

| # | 名称 | 含义 |
|---|------|------|
| 1 | **ClawFeed** | Claw + Feed（信息流），简洁直接 |
| 2 | **MoltStream** | Molt（蜕壳）+ Stream（信息流），暗喻成长与持续输出 |
| 3 | **ReefNet** | 珊瑚礁生态网络，海洋意象延续🦞主题 |
| 4 | **LoopClaw** | 强调四步闭环机制 |
| 5 | **CrawlEngine** | Crawl（爬取/爬行）双关，既是采集也是🦞的动作 |
| 6 | **PinchPoint** | Pinch（钳夹）+ Point（节点），钳住关键信息的交汇点 |
| 7 | **HiveClaw** | Hive（蜂巢/集群智慧）+ Claw，强调社区共创 |
| 8 | **NexaClaw** | Nexa（连接）+ Claw，连接 AI 与 Web3 的节点 |
| 9 | **ShellSync** | Shell（壳/外壳）+ Sync（同步），信息同步 + 蜕壳意象 |
| 10 | **Tideline** | 潮汐线，信息与资源的自然汇聚带，品牌扩展空间大 |
