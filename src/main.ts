import 'dotenv/config'
import { Bot } from 'grammy'
import { createPrisma } from './db/database.js'
import { createLLMAdapter, resolveLLMRuntimeConfig } from './producer/llm.js'
import { seedAgentRoles } from './db/agent-roles.js'
import { startScheduler } from './scheduler.js'
import { registerHandlers } from './bot/handlers.js'

let llmRuntime
try {
  llmRuntime = resolveLLMRuntimeConfig(process.env)
} catch (error) {
  console.error(`${error instanceof Error ? error.message : String(error)}. Set it in .env`)
  process.exit(1)
}

const prisma = createPrisma()
const llm = createLLMAdapter(llmRuntime)

console.log('CryptoOpenClaw engine starting...')
await seedAgentRoles(prisma)
console.log('Agent roles seeded.')
console.log(`Database: ${process.env.DATABASE_URL?.replace(/\/\/.*@/, '//***@')}`)

// Start Bot in long-polling mode
const botToken = process.env.TG_BOT_TOKEN
let bot: Bot | undefined
if (botToken) {
  bot = new Bot(botToken)
  registerHandlers(bot, prisma)
  bot.start()
  console.log('Bot started in long-polling mode.')
} else {
  console.warn('TG_BOT_TOKEN not set, bot disabled.')
}

startScheduler(prisma, llm, bot)

// Keep process alive
process.on('SIGINT', async () => {
  console.log('\nShutting down...')
  bot?.stop()
  await prisma.$disconnect()
  process.exit(0)
})
