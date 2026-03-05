import 'dotenv/config'
import { createPrisma } from './database.js'

const CATEGORIES = [
  { name: 'agriculture', nameZh: '农业养殖', icon: '🌱', sortOrder: 1 },
  { name: 'media', nameZh: '内容媒体', icon: '📰', sortOrder: 2 },
  { name: 'finance', nameZh: '交易金融', icon: '💹', sortOrder: 3 },
  { name: 'gaming', nameZh: '游戏娱乐', icon: '🎮', sortOrder: 4 },
  { name: 'devtools', nameZh: '开发工具', icon: '🔧', sortOrder: 5 },
  { name: 'education', nameZh: '教育学习', icon: '📚', sortOrder: 6 },
]

const DIRECTIONS = [
  { category: 'agriculture', name: 'tomato-growing', nameZh: '种番茄', icon: '🍅', descriptionZh: '使用 OpenClaw 规划番茄种植周期、病虫害防治、浇灌提醒', userCount: 342, rating: 4.5, featured: true },
  { category: 'agriculture', name: 'fish-farming', nameZh: '养鱼', icon: '🐟', descriptionZh: '水质监测、喂食提醒、鱼类健康管理', userCount: 218, rating: 4.2, featured: true },
  { category: 'agriculture', name: 'herb-garden', nameZh: '香草种植', icon: '🌿', descriptionZh: '室内香草园规划与养护指导', userCount: 156, rating: 4.0 },
  { category: 'media', name: 'crypto-news', nameZh: '加密新闻', icon: '📰', descriptionZh: '自动化加密货币新闻采集、分析与发布', userCount: 891, rating: 4.7, featured: true },
  { category: 'media', name: 'content-translation', nameZh: '内容翻译', icon: '🌐', descriptionZh: '多语言内容自动翻译与本地化', userCount: 467, rating: 4.3 },
  { category: 'media', name: 'social-media', nameZh: '自媒体运营', icon: '📱', descriptionZh: '社交媒体内容规划、生成与发布管理', userCount: 623, rating: 4.4, featured: true },
  { category: 'finance', name: 'market-analysis', nameZh: '行情分析', icon: '📊', descriptionZh: '加密货币市场趋势分析与信号监测', userCount: 1205, rating: 4.6, featured: true },
  { category: 'finance', name: 'portfolio-tracking', nameZh: '投资组合追踪', icon: '💰', descriptionZh: '多链资产组合监控与收益计算', userCount: 534, rating: 4.1 },
  { category: 'finance', name: 'risk-management', nameZh: '风控管理', icon: '🛡️', descriptionZh: '交易风险评估与止损策略', userCount: 312, rating: 4.0 },
  { category: 'gaming', name: 'npc-dialogue', nameZh: 'NPC 对话', icon: '💬', descriptionZh: '游戏 NPC 智能对话生成', userCount: 445, rating: 4.3 },
  { category: 'gaming', name: 'quest-design', nameZh: '任务设计', icon: '⚔️', descriptionZh: '游戏任务和剧情自动生成', userCount: 287, rating: 4.1 },
  { category: 'devtools', name: 'code-review', nameZh: '代码审查', icon: '🔍', descriptionZh: '自动化代码审查与质量检测', userCount: 756, rating: 4.5, featured: true },
  { category: 'devtools', name: 'doc-generation', nameZh: '文档生成', icon: '📄', descriptionZh: '从代码自动生成 API 文档与使用指南', userCount: 534, rating: 4.2 },
  { category: 'devtools', name: 'debug-assistant', nameZh: '调试助手', icon: '🐛', descriptionZh: '智能错误分析与修复建议', userCount: 423, rating: 4.3 },
  { category: 'education', name: 'language-learning', nameZh: '语言学习', icon: '🗣️', descriptionZh: '个性化语言学习计划与练习', userCount: 678, rating: 4.4, featured: true },
  { category: 'education', name: 'knowledge-qa', nameZh: '知识问答', icon: '❓', descriptionZh: '领域知识问答与学习辅导', userCount: 512, rating: 4.2 },
]

async function main() {
  const prisma = createPrisma()

  // Seed categories
  for (const cat of CATEGORIES) {
    await prisma.category.upsert({
      where: { name: cat.name },
      create: cat,
      update: {},
    })
  }
  console.log(`Seeded ${CATEGORIES.length} categories`)

  // Get category ID map
  const cats = await prisma.category.findMany()
  const catMap = new Map(cats.map((c: any) => [c.name, c.id]))

  // Seed directions
  for (const dir of DIRECTIONS) {
    const categoryId = catMap.get(dir.category)!
    const slug = dir.name
    await prisma.direction.upsert({
      where: { slug },
      create: {
        categoryId,
        name: dir.name,
        nameZh: dir.nameZh,
        slug,
        descriptionZh: dir.descriptionZh,
        icon: dir.icon,
        userCount: dir.userCount,
        rating: dir.rating,
        featured: dir.featured ?? false,
      },
      update: {},
    })
  }
  console.log(`Seeded ${DIRECTIONS.length} directions`)

  await prisma.$disconnect()
}

main().catch(console.error)
