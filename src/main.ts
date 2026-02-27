import path from 'path'
import { createDb } from './db/database.js'
import { createAnthropicAdapter } from './producer/llm.js'
import { startScheduler } from './scheduler.js'

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is required. Set it in .env')
  process.exit(1)
}

const dbPath = path.join(process.cwd(), 'data', 'clawnews.db')
const db = createDb(dbPath)
const llm = createAnthropicAdapter(apiKey)

console.log('ClawNews engine starting...')
console.log(`Database: ${dbPath}`)

startScheduler(db, llm)

// Keep process alive
process.on('SIGINT', () => {
  console.log('\nShutting down...')
  db.close()
  process.exit(0)
})
