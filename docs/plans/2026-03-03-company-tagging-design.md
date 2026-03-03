# 公司标签设计：从新闻中提取公司实体

## 目标

在 LLM 内容生产阶段自动提取新闻中提及的公司/项目，建立独立的公司数据库，为后续做 RootData 类服务打基础。

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 数据来源 | LLM 提取 | 零额外成本，只改 prompt |
| 存储方式 | 独立 Company 表 + 关联表 | 天然去重，后续建公司页方便 |
| 字段丰富度 | 适度（name/description/category） | 融资等数据新闻里提取不出 |
| 新公司处理 | 自动创建 | 早期快速积累，错误后期修正 |
| 去重策略 | LLM 标准化名称 + slug 唯一键 | 双重保障 |

## 数据模型

### companies 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | String | 公司官方名称，如 "OpenAI" |
| slug | String (unique) | 归一化标识，如 "openai" |
| description | String? | 一句话简介，LLM 生成 |
| website | String? | 官网 URL |
| logo_url | String? | Logo 地址 |
| category | String | 赛道：AI/DeFi/Infrastructure/L1-L2/Gaming/NFT/DAO/Exchange/Wallet/Other |
| mention_count | Int | 被新闻提及次数 |
| created_at | DateTime | 创建时间 |

### article_companies 关联表

| 字段 | 类型 | 说明 |
|------|------|------|
| article_id | UUID FK | → articles.id |
| company_id | UUID FK | → companies.id |

联合主键，防重复关联。

## LLM Prompt 改动

在 produce prompt 中新增 `companies` 字段：

```json
{
  "title_zh": "...",
  "summary_zh": "...",
  "analysis_zh": "...",
  "tags": ["ai", "defi"],
  "companies": [
    {
      "name": "OpenAI",
      "category": "AI",
      "description": "领先的人工智能研究公司"
    }
  ]
}
```

Prompt 关键指令：
- 只提取新闻中明确提及的公司/项目
- 返回公司官方名称
- category 限定枚举：AI、DeFi、Infrastructure、L1/L2、Gaming、NFT、DAO、Exchange、Wallet、Other
- 没有公司则返回空数组
- description 用一句中文描述

## 处理流程

1. LLM 返回后解析 companies 数组
2. 对每个公司：生成 slug → upsert companies 表 → mention_count +1
3. 批量写入 article_companies 关联
4. 公司提取失败不影响文章入库（graceful degradation）

Slug 生成：`name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')`

## 文件变更

| 文件 | 变更 |
|------|------|
| `prisma/schema.prisma` | 新增 Company、ArticleCompany 模型 |
| `src/producer/produce.ts` | prompt 加 companies，解析后入库 |
| `src/db/database.ts` | 新增 upsertCompany、linkArticleCompany |
| `tests/producer/produce.test.ts` | 更新 mock 和断言 |
| `tests/e2e/pipeline.test.ts` | 验证公司关联流程 |

不改：formatter、publisher、dashboard、dedup、scheduler。
