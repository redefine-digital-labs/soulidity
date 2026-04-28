import '../../scripts/lib/dotenv.js'
import { createPrisma } from '../db/database.js'
import { createLLMAdapter, resolveLLMRuntimeConfig } from './llm.js'
import { produceArticles } from './produce.js'
import { autoPublish } from '../publisher/publish.js'

let llmRuntime
try {
  llmRuntime = resolveLLMRuntimeConfig(process.env)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const prisma = createPrisma()
const llm = createLLMAdapter(llmRuntime)

console.log('Producing articles...')
const result = await produceArticles(prisma, llm, 10, 3)
console.log(`Done. Processed ${result.processed}, succeeded ${result.succeeded}, failed ${result.failed}.`)

console.log('Auto-publishing drafts older than 10 minutes...')
const pubResult = await autoPublish(prisma)
console.log(`Auto-publish: published ${pubResult.published}, failed ${pubResult.failed}`)

await prisma.$disconnect()
