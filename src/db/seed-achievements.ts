import 'dotenv/config'
import { createPrisma } from './database.js'
import { logger } from '../shared/logger.js'

const log = logger.child('seed-achievements')

const ACHIEVEMENTS = [
  { name: 'first-post', nameZh: '首次发布', icon: '🌱', description: '发布第一篇养成日志', condition: 'posts >= 1' },
  { name: 'streak-7', nameZh: '连续7天', icon: '🔥', description: '连续7天发布日志', condition: 'streak >= 7' },
  { name: 'streak-30', nameZh: '坚持30天', icon: '💪', description: '连续30天发布日志', condition: 'streak >= 30' },
  { name: 'helper', nameZh: '热心助人', icon: '🤝', description: '帮助他人解答10个问题', condition: 'comments >= 10' },
  { name: 'popular', nameZh: '人气之星', icon: '⭐', description: '单篇日志获得50个赞', condition: 'max_likes >= 50' },
  { name: 'expert', nameZh: '方向达人', icon: '🎓', description: '某方向被评为优质贡献者', condition: 'manual' },
  { name: 'mentor', nameZh: '社区导师', icon: '👨‍🏫', description: '社区贡献突出获得导师认证', condition: 'manual' },
]

async function main() {
  const prisma = createPrisma()

  for (const ach of ACHIEVEMENTS) {
    await prisma.achievement.upsert({
      where: { name: ach.name },
      create: ach,
      update: {},
    })
  }
  log.info(`Seeded ${ACHIEVEMENTS.length} achievements`)

  await prisma.$disconnect()
}

main().catch((err) => log.error('seed failed', err))
