import 'dotenv/config'
import { createPrisma } from '../db/database.js'
import { createAnthropicAdapter } from './llm.js'
import { produceArticles } from './produce.js'

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is required')
  process.exit(1)
}

const prisma = createPrisma()
const llm = createAnthropicAdapter(apiKey)

console.log('Producing articles...')
const result = await produceArticles(prisma, llm)
console.log(`Done. Processed ${result.processed}, succeeded ${result.succeeded}, failed ${result.failed}.`)
await prisma.$disconnect()
