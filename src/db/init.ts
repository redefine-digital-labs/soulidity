import { createDb } from './database.js'
import path from 'path'

const dbPath = path.join(process.cwd(), 'data', 'clawnews.db')
const db = createDb(dbPath)
console.log(`Database initialized at ${dbPath}`)
db.close()
