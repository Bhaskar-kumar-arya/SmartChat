import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { vi, beforeAll, afterAll } from 'vitest'

// Electron is mocked via vitest.config.ts alias pointing to electron-mock.ts

// Hermetic: never open a websocket to a local LM Studio instance. AIService constructs
// an LMStudioProvider (and thus an LMStudioClient) eagerly; the real client connects on
// construction and rejects asynchronously when LM Studio is not running.
vi.mock('@lmstudio/sdk', () => {
  class LMStudioClient {
    public llm = {
      load: vi.fn().mockRejectedValue(new Error('LM Studio is mocked in tests')),
      unload: vi.fn().mockResolvedValue(undefined),
      listLoaded: vi.fn().mockResolvedValue([])
    }
    public system = { listDownloadedModels: vi.fn().mockResolvedValue([]) }
  }
  const Chat = { empty: vi.fn(() => ({ append: vi.fn() })), from: vi.fn(() => ({ append: vi.fn() })) }
  return { LMStudioClient, Chat }
})

// Mock EmbeddingService globally
vi.mock('../services/search/EmbeddingService', () => {
  return {
    EmbeddingService: class MockEmbeddingService {
      public setPaused = vi.fn()
      public isPaused = vi.fn().mockReturnValue(false)
      public queueMessageForEmbedding = vi.fn().mockResolvedValue(undefined)
      public indexMessage = vi.fn().mockResolvedValue(undefined)
      public indexAll = vi.fn().mockResolvedValue(undefined)
      public clearAllVectors = vi.fn().mockResolvedValue(undefined)
    }
  }
})

// Mock VectorSyncService globally
vi.mock('../services/search/VectorSyncService', () => {
  return {
    VectorSyncService: class MockVectorSyncService {
      public sync = vi.fn().mockResolvedValue(undefined)
    }
  }
})

const workerId = process.env.VITEST_WORKER_ID || process.pid.toString()
const dbPath = join(__dirname, `../../../prisma/test-worker-${workerId}.db`)
const databaseUrl = `file:${dbPath}`
process.env.DATABASE_URL = databaseUrl

let prismaTestClient: PrismaClient

const templateDbPath = join(__dirname, '../../../prisma/template-test.db')

beforeAll(async () => {
  // 1. Clean up old test db if present
  if (existsSync(dbPath)) {
    try {
      unlinkSync(dbPath)
    } catch (err) {
      console.warn('[Test Setup] Failed to unlink existing test database:', err)
    }
  }

  // 2. Template DB is created once, before any worker starts, by globalSetup.ts (B-DATA-07)
  if (!existsSync(templateDbPath)) {
    throw new Error(`[Test Setup] ${templateDbPath} missing: globalSetup did not run`)
  }

  // 3. Fast copy from template DB
  const { copyFileSync } = require('fs')
  copyFileSync(templateDbPath, dbPath)

  const adapter = new PrismaBetterSqlite3({
    url: databaseUrl
  })
  prismaTestClient = new PrismaClient({ adapter })
})

afterAll(async () => {
  if (prismaTestClient) {
    await prismaTestClient.$disconnect()
  }
  // Optional: remove test database file to leave workspace clean
  if (existsSync(dbPath)) {
    try {
      unlinkSync(dbPath)
    } catch (err) {
      console.warn('[Test Setup] Failed to clean up test database file:', err)
    }
  }
  
  // Clean up user data directory
  const userDataDir = join(__dirname, `../../../prisma/test-user-data-${workerId}`)
  if (existsSync(userDataDir)) {
    try {
      const fs = require('fs')
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch (err) {
      console.warn('[Test Setup] Failed to clean up test-user-data:', err)
    }
  }
})
