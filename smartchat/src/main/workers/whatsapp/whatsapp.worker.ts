import { parentPort } from 'worker_threads'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { bootstrapWorkerRepositories } from './bootstrapWorkerRepositories'
import { WorkerConnectionManager } from './socket/workerConnectionManager'
import { WorkerCommandRouter } from './routing/workerCommandRouter'
import { WorkerCommandMessage } from './whatsappWorker.types'
import { runMigrations, RawSqliteDb } from '../../db/schema-migrations'

// better-sqlite3 is a CJS module; require() is intentional here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const openDatabase = require('better-sqlite3') as new (path: string) => RawSqliteDb

console.log('[WhatsAppWorker] Worker thread spawned and starting up...')

const eventPublisher = {
  publish: (event: string, data?: unknown) => {
    parentPort?.postMessage({
      type: 'domain_event',
      payload: { event, data }
    })
  }
}

const connectionManager = new WorkerConnectionManager(eventPublisher)

async function bootstrapPrismaAndRepos(dbPath: string, userDataPath: string) {
  // Run schema migrations synchronously before Prisma touches the DB.
  // Uses a short-lived raw better-sqlite3 connection so we don't depend on
  // Prisma being able to open a schema-inconsistent database.
  try {
    const migrationDb = new openDatabase(dbPath)
    runMigrations(migrationDb)
    migrationDb.close()
  } catch (err) {
    console.error('[WhatsAppWorker] Schema migration failed — worker may be in a broken state:', err)
  }

  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` })
  const prisma = new PrismaClient({ adapter })

  await prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000;')
  await prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL;')
  await prisma.$executeRawUnsafe('PRAGMA synchronous = NORMAL;')

  const repos = bootstrapWorkerRepositories(
    prisma,
    userDataPath,
    eventPublisher,
    () => connectionManager.getSocket()
  )

  return { prisma, repos }
}

const commandRouter = new WorkerCommandRouter(connectionManager, bootstrapPrismaAndRepos)

parentPort?.on('message', async (msg: unknown) => {
  if (!msg || typeof msg !== 'object') {
    return
  }
  await commandRouter.handleCommand(msg as WorkerCommandMessage)
})
