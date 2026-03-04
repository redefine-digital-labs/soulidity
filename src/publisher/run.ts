import 'dotenv/config'
import { createPrisma } from '../db/database.js'
import { autoPublish } from './publish.js'

const prisma = createPrisma()
console.log('Running auto-publish...')
const result = await autoPublish(prisma)
console.log(`Done. Published: ${result.published}, Failed: ${result.failed}`)
await prisma.$disconnect()
