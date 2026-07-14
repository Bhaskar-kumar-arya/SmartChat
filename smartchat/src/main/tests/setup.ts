import { execSync } from 'child_process'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { vi, beforeAll, afterAll } from 'vitest'

// Electron is mocked via vitest.config.ts alias pointing to electron-mock.ts

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

const dbPath = join(__dirname, '../../../prisma/test.db')
const databaseUrl = `file:${dbPath}`
process.env.DATABASE_URL = databaseUrl

let prismaTestClient: PrismaClient

beforeAll(async () => {
  // 1. Clean up old test db if present
  if (existsSync(dbPath)) {
    try {
      unlinkSync(dbPath)
    } catch (err) {
      console.warn('[Test Setup] Failed to unlink existing test database:', err)
    }
  }

  console.log('[Test Setup] Initializing clean SQLite test database at', dbPath)
  
  // 2. Run Prisma push to create tables in the test db (excludes vector search table)
  execSync('npx prisma db push --accept-data-loss', {
    stdio: 'inherit',
    cwd: join(__dirname, '../../..')
  })

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
  const userDataDir = join(__dirname, '../../../../prisma/test-user-data')
  if (existsSync(userDataDir)) {
    try {
      const fs = require('fs')
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch (err) {
      console.warn('[Test Setup] Failed to clean up test-user-data:', err)
    }
  }
})
