import { parentPort } from 'worker_threads'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { bootstrapWorkerRepositories } from './bootstrapWorkerRepositories'
import { WorkerConnectionManager } from './socket/workerConnectionManager'
import { WorkerCommandRouter } from './routing/workerCommandRouter'
import { WorkerCommandMessage } from './whatsappWorker.types'

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
