import 'dotenv/config'
import { createPrisma } from './db/database.js'
import { createLLMAdapter } from './producer/llm.js'
import { produceArticles } from './producer/produce.js'
import { autoPublish } from './publisher/publish.js'

const prisma = createPrisma()
const llm = createLLMAdapter({
  apiKey: process.env.GEMINI_API_KEY!,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  model: 'gemini-2.5-flash',
})

console.log('Starting manual produce run...')
let totalSucceeded = 0, totalFailed = 0
while (true) {
  const result = await produceArticles(prisma, llm)
  if (result.processed === 0) break
  totalSucceeded += result.succeeded
  totalFailed += result.failed
  console.log(`  batch: processed ${result.processed}, succeeded ${result.succeeded}, failed ${result.failed}`)
  if (result.fatalError) { console.log('  fatal error, stopping'); break }
}
console.log(`Producer done: succeeded ${totalSucceeded}, failed ${totalFailed}`)

console.log('Running auto-publish...')
const pubResult = await autoPublish(prisma)
console.log(`Published: ${pubResult.published}, failed: ${pubResult.failed}`)

await prisma.$disconnect()
