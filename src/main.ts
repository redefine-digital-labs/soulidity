import 'dotenv/config'
import { createPrisma } from './db/database.js'
import { createZaiAdapter } from './producer/llm.js'
import { seedAgentRoles } from './db/agent-roles.js'
import { startScheduler } from './scheduler.js'

const apiKey = process.env.ZAI_API_KEY
if (!apiKey) {
  console.error('ZAI_API_KEY is required. Set it in .env')
  process.exit(1)
}

const prisma = createPrisma()
const llm = createZaiAdapter(apiKey)

console.log('CryptoOpenClaw engine starting...')
await seedAgentRoles(prisma)
console.log('Agent roles seeded.')
console.log(`Database: ${process.env.DATABASE_URL?.replace(/\/\/.*@/, '//***@')}`)

startScheduler(prisma, llm)

// Keep process alive
process.on('SIGINT', async () => {
  console.log('\nShutting down...')
  await prisma.$disconnect()
  process.exit(0)
})
