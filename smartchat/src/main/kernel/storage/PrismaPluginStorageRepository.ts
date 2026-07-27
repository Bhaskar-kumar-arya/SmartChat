import { PrismaClient } from '@prisma/client'
import { IKernelStorageRepository } from '../api-modules/KernelStorageModule'

export class PrismaPluginStorageRepository implements IKernelStorageRepository {
  constructor(private prisma: PrismaClient) {}

  async get(pluginId: string, key: string): Promise<string | undefined> {
    const entry = await this.prisma.extensionKV.findUnique({
      where: {
        extensionId_key: {
          extensionId: pluginId,
          key
        }
      }
    })
    return entry?.value
  }

  async set(pluginId: string, key: string, value: string): Promise<void> {
    await this.prisma.extensionKV.upsert({
      where: {
        extensionId_key: { extensionId: pluginId, key }
      },
      update: { value },
      create: { extensionId: pluginId, key, value }
    })
  }

  async delete(pluginId: string, key: string): Promise<void> {
    try {
      await this.prisma.extensionKV.delete({
        where: {
          extensionId_key: { extensionId: pluginId, key }
        }
      })
    } catch {
      // Ignore if not found
    }
  }

  async clear(pluginId: string): Promise<void> {
    await this.prisma.extensionKV.deleteMany({
      where: { extensionId: pluginId }
    })
  }

  async keys(pluginId: string): Promise<string[]> {
    const entries = await this.prisma.extensionKV.findMany({
      where: { extensionId: pluginId },
      select: { key: true }
    })
    return entries.map((e) => e.key)
  }
}
