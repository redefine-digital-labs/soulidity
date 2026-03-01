import 'dotenv/config'
import { createDb } from '../db/database.js'
import { createAnthropicAdapter } from './llm.js'
import { produceArticles } from './produce.js'
import path from 'path'

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is required')
  process.exit(1)
}

const db = createDb(path.join(process.cwd(), 'data', 'clawnews.db'))
const llm = createAnthropicAdapter(apiKey)

console.log('Producing articles...')
const result = await produceArticles(db, llm)
console.log(`Done. Processed ${result.processed}, succeeded ${result.succeeded}, failed ${result.failed}.`)
db.close()
