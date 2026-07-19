import { PrismaClient } from '@prisma/client'
import { IExtensionStorageRepository } from './IExtensionStorageRepository'

export class ExtensionStorageRepository implements IExtensionStorageRepository {
  constructor(private prisma: PrismaClient) {}

  async get(extensionId: string, key: string): Promise<string | undefined> {
    const entry = await this.prisma.extensionKV.findUnique({
      where: {
        extensionId_key: {
          extensionId,
          key
        }
      }
    })
    return entry?.value
  }

  async set(extensionId: string, key: string, value: string): Promise<void> {
    await this.prisma.extensionKV.upsert({
      where: {
        extensionId_key: { extensionId, key }
      },
      update: { value },
      create: { extensionId, key, value }
    })
  }

  async delete(extensionId: string, key: string): Promise<void> {
    try {
      await this.prisma.extensionKV.delete({
        where: {
          extensionId_key: { extensionId, key }
        }
      })
    } catch (e) {
      // Ignore if not found
    }
  }

  async clear(extensionId: string): Promise<void> {
    await this.prisma.extensionKV.deleteMany({
      where: { extensionId }
    })
  }

  async keys(extensionId: string): Promise<string[]> {
    const entries = await this.prisma.extensionKV.findMany({
      where: { extensionId },
      select: { key: true }
    })
    return entries.map((e) => e.key)
  }
}
