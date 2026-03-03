import 'dotenv/config'
import { createPrisma } from '../db/database.js'
import { runDedup } from './dedup.js'

const prisma = createPrisma()

console.log('Running deduplication...')
const result = await runDedup(prisma)
console.log(`Done. Total: ${result.total}, kept: ${result.kept}, duplicates: ${result.duplicates}`)
await prisma.$disconnect()
