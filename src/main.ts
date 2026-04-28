import '../scripts/lib/dotenv.js'
import { Bot } from 'grammy'
import { createPrisma } from './db/database.js'
import { createLLMAdapter, resolveLLMRuntimeConfig } from './producer/llm.js'
import { seedAgentRoles } from './db/agent-roles.js'
import { startScheduler } from './scheduler.js'
import { registerHandlers } from './bot/handlers.js'
import { captureBackendException, shutdownPostHog } from './observability/posthog.js'
import type { PrismaClient } from './db/database.js'

const SHUTDOWN_TIMEOUT_MS = 5_000

let prisma: PrismaClient | undefined
let bot: Bot | undefined
let shutdownStarted = false

async function withShutdownTimeout(label: string, operation: Promise<void>): Promise<void> {
  let timeout: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      operation,
      new Promise<void>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timed out after ${SHUTDOWN_TIMEOUT_MS}ms`))
        }, SHUTDOWN_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function shutdownRuntime(exitCode: number): Promise<never> {
  if (shutdownStarted) {
    process.exit(exitCode)
  }
  shutdownStarted = true

  try {
    bot?.stop()
  } catch (error) {
    console.error('[shutdown] failed to stop bot:', error)
  }

  try {
    if (prisma) {
      await withShutdownTimeout('prisma disconnect', prisma.$disconnect())
    }
  } catch (error) {
    console.error('[shutdown] failed to disconnect prisma:', error)
  }

  try {
    await withShutdownTimeout('posthog shutdown', shutdownPostHog())
  } catch (error) {
    console.error('[shutdown] failed to flush posthog:', error)
  }

  process.exit(exitCode)
}

function captureFatalException(scope: 'uncaughtException' | 'unhandledRejection', error: unknown): void {
  try {
    captureBackendException(error, { scope })
  } catch (captureError) {
    console.error(`[${scope}] failed to capture exception:`, captureError)
  }
}

process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error)
  captureFatalException('uncaughtException', error)
  void shutdownRuntime(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
  captureFatalException('unhandledRejection', reason)
  void shutdownRuntime(1)
})

const llmRuntime = resolveLLMRuntimeConfig(process.env)
if (!llmRuntime) {
  console.warn('DEEPSEEK_API_KEY not set, LLM disabled — content production will be skipped.')
}

prisma = createPrisma()
const llm = llmRuntime ? createLLMAdapter(llmRuntime) : undefined

console.log('CryptoOpenClaw engine starting...')
await seedAgentRoles(prisma)
console.log('Agent roles seeded.')
console.log(`Database: ${process.env.DATABASE_URL?.replace(/\/\/.*@/, '//***@')}`)

// Start Bot in long-polling mode
const botToken = process.env.TG_BOT_TOKEN
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
  await shutdownRuntime(0)
})
