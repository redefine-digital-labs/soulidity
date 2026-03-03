import 'dotenv/config'
import { createPrisma } from '../db/database.js'
import { createZaiAdapter } from './llm.js'
import { produceArticles } from './produce.js'

const apiKey = process.env.ZAI_API_KEY
if (!apiKey) {
  console.error('ZAI_API_KEY is required')
  process.exit(1)
}

const prisma = createPrisma()
const llm = createZaiAdapter(apiKey)

console.log('Producing articles...')
const result = await produceArticles(prisma, llm)
console.log(`Done. Processed ${result.processed}, succeeded ${result.succeeded}, failed ${result.failed}.`)
await prisma.$disconnect()
