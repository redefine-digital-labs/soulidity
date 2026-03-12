import 'dotenv/config'
import { createPrisma } from './database.js'

const prisma = createPrisma()

const MOCK_BUNDLES = [
  {
    name: 'CryptoNews 自动采集器',
    description: '全自动加密货币新闻采集、翻译、摘要生成与多平台分发模板。支持 Twitter/X、RSS、Telegram 数据源。',
    category: '内容媒体',
    tags: ['新闻', '加密货币', '自动化', 'AI翻译'],
    version: '2.1.0',
    readme: `# CryptoNews 自动采集器 v2.1

## 功能特性
- 多源数据采集：Twitter/X、RSS、Telegram 频道
- AI 智能翻译（中/英/日/韩）
- 自动生成新闻摘要与深度分析
- 一键发布到 Telegram 频道、Discord、网站

## 使用方法
1. 解压后配置 .env 文件
2. 填入你的 API Key 和频道信息
3. 运行 \`npm start\` 启动采集

## 适用场景
- 加密媒体运营
- 投研团队信息聚合
- 个人新闻 Bot 搭建`,
    priceSUI: 2.5,
    previewImages: [
      'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=600&h=400&fit=crop',
      'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&h=400&fit=crop',
    ],
  },
  {
    name: 'DeFi 收益追踪仪表盘',
    description: '实时监控多链 DeFi 收益，自动计算 APY/APR，支持 Sui、Ethereum、Solana 生态。',
    category: '交易金融',
    tags: ['DeFi', '收益追踪', '多链', '仪表盘'],
    version: '1.3.0',
    readme: `# DeFi 收益追踪仪表盘

## 功能
- 多链资产自动发现（Sui / ETH / SOL）
- 实时 APY/APR 计算
- 收益历史图表
- Telegram 告警通知

## 技术栈
- Next.js + TailwindCSS
- Sui SDK / Ethers.js / Solana Web3
- PostgreSQL 存储`,
    priceSUI: 5.0,
    previewImages: [
      'https://images.unsplash.com/photo-1642790106117-e829e14a795f?w=600&h=400&fit=crop',
    ],
  },
  {
    name: 'AI 客服 Bot 模板',
    description: '基于 Claude API 的智能客服 Bot，支持 Telegram 和网页嵌入，开箱即用。',
    category: '开发工具',
    tags: ['AI', '客服', 'Telegram Bot', 'Claude'],
    version: '1.0.0',
    readme: `# AI 客服 Bot 模板

## 特点
- 基于 Claude API，对话质量高
- Telegram Bot + Web Widget 双端
- 知识库管理界面
- 对话历史分析

## 快速开始
1. 配置 Claude API Key
2. 设置 Telegram Bot Token
3. 导入知识库文档
4. 一键部署到 Vercel / Railway`,
    priceSUI: 1.0,
    previewImages: [
      'https://images.unsplash.com/photo-1531746790095-e5995aaec39e?w=600&h=400&fit=crop',
      'https://images.unsplash.com/photo-1676299081847-824916de030a?w=600&h=400&fit=crop',
    ],
  },
  {
    name: 'SEO 内容工厂',
    description: '批量生成 SEO 优化文章，自动关键词研究、内容规划、发布排期。养网站防老必备。',
    category: '内容媒体',
    tags: ['SEO', '内容生成', '自动化', '被动收入'],
    version: '3.0.0',
    readme: `# SEO 内容工厂 v3.0

## 核心能力
- 关键词自动研究与竞争分析
- AI 批量生成高质量 SEO 文章
- 内部链接自动建设
- 发布排期管理
- Google Search Console 集成

## 适合谁
- 独立站长
- 内容创业者
- 副业探索者`,
    priceSUI: 8.0,
    previewImages: [
      'https://images.unsplash.com/photo-1432888498266-38ffec3eaf0a?w=600&h=400&fit=crop',
      'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&h=400&fit=crop',
      'https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?w=600&h=400&fit=crop',
    ],
  },
  {
    name: 'Sui Move NFT 铸造模板',
    description: '完整的 Sui Move NFT 铸造合约 + 前端 Mint 页面，支持白名单、阶段定价。',
    category: '开发工具',
    tags: ['Sui', 'Move', 'NFT', '智能合约'],
    version: '1.2.0',
    readme: `# Sui Move NFT 铸造模板

## 包含内容
- Move 智能合约（已审计）
- React Mint 页面
- 白名单管理工具
- 多阶段定价配置

## 合约特性
- 可升级设计
- 版税自动分配
- 动态 NFT 元数据
- Gas 优化`,
    priceSUI: 15.0,
    previewImages: [
      'https://images.unsplash.com/photo-1646463535015-b8dfbf846382?w=600&h=400&fit=crop',
    ],
  },
  {
    name: '多语言翻译 API 网关',
    description: '统一封装 DeepL / Google / Claude 翻译接口，自动选择最优引擎，附带用量统计。',
    category: '开发工具',
    tags: ['翻译', 'API', '多语言', '网关'],
    version: '1.1.0',
    readme: `# 多语言翻译 API 网关

## 支持引擎
- DeepL API
- Google Cloud Translation
- Claude / GPT 翻译

## 特点
- 智能引擎路由（按语种选最优）
- 统一 REST API 接口
- 用量统计与费用追踪
- 缓存层减少重复调用`,
    priceSUI: 3.0,
    previewImages: [
      'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&h=400&fit=crop',
    ],
  },
]

async function main() {
  console.log('Seeding marketplace mock data...')

  // Find or create a mock seller
  let seller = await prisma.member.findFirst({ where: { tgId: '999999001' } })
  if (!seller) {
    seller = await prisma.member.create({
      data: {
        tgId: '999999001',
        tgName: 'OpenClaw 官方',
        avatar: null,
        level: 5,
        exp: 10000,
      },
    })
    console.log('Created mock seller:', seller.id)
  }

  // Create a WalletBinding for the seller
  let wallet = await prisma.walletBinding.findFirst({ where: { memberId: seller.id, chain: 'sui', isPrimary: true } })
  if (!wallet) {
    wallet = await prisma.walletBinding.create({
      data: {
        memberId: seller.id,
        chain: 'sui',
        address: '0x' + 'a'.repeat(64),
        isPrimary: true,
      },
    })
    console.log('Created mock wallet binding:', wallet.id)
  }

  for (const mock of MOCK_BUNDLES) {
    // Check if bundle already exists
    const existing = await prisma.agentBundle.findFirst({
      where: { name: mock.name, sellerId: seller.id },
    })
    if (existing) {
      console.log(`  Skip (exists): ${mock.name}`)
      continue
    }

    const bundle = await prisma.agentBundle.create({
      data: {
        sellerId: seller.id,
        name: mock.name,
        description: mock.description,
        category: mock.category,
        tags: mock.tags,
        version: mock.version,
        storagePath: `${seller.id}/mock-${Date.now()}.zip`,
        contentHash: Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
        previewImages: mock.previewImages,
        readme: mock.readme,
        status: 'active',
      },
    })

    await prisma.listing.create({
      data: {
        bundleId: bundle.id,
        sellerWalletAddress: wallet.address,
        priceMist: BigInt(Math.round(mock.priceSUI * 1e9)),
        currency: 'SUI',
        status: 'active',
      },
    })

    console.log(`  Created: ${mock.name} (${mock.priceSUI} SUI)`)
  }

  console.log('Done!')
  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
