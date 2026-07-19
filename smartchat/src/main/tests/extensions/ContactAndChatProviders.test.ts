import fs from 'fs'
import path from 'path'
import { ExtensionLoader } from '../../extensions/host/ExtensionLoader'
import { ExtensionCapabilityRegistry } from '../../extensions/capabilities/ExtensionCapabilityRegistry'
import { ExtensionHost } from '../../extensions/host/ExtensionHost'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ContactsCapabilityProvider } from '../../extensions/capabilities/providers/ContactsCapabilityProvider'
import { ChatsCapabilityProvider } from '../../extensions/capabilities/providers/ChatsCapabilityProvider'
import { LogCapabilityProvider } from '../../extensions/capabilities/providers/LogCapabilityProvider'
import AdmZip from 'adm-zip'

describe('ContactAndChatProviders', () => {
  let tmpDir: string
  let registry: ExtensionCapabilityRegistry
  let host: ExtensionHost
  let mockContactService: any
  let mockChatService: any

  beforeEach(() => {
    tmpDir = path.join(__dirname, 'tmp_ext_06')
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
    fs.mkdirSync(tmpDir, { recursive: true })

    mockContactService = {
      getMePhoneNumberJid: vi.fn(async () => '1234567890@s.whatsapp.net')
    }

    mockChatService = {
      getChatList: vi.fn(async (_page, limit) => {
        return [
          { jid: '1@s.whatsapp.net', name: 'Alice' },
          { jid: '2@s.whatsapp.net', name: 'Bob' }
        ].slice(0, limit)
      })
    }

    const loader = new ExtensionLoader(tmpDir)
    registry = new ExtensionCapabilityRegistry()

    const logProvider = new LogCapabilityProvider(tmpDir)
    registry.register('log', logProvider)
    registry.register('contacts', new ContactsCapabilityProvider(mockContactService))
    registry.register('chats', new ChatsCapabilityProvider(mockChatService))

    host = new ExtensionHost(
      loader,
      registry,
      {
        setInterval: vi.fn(),
        setTimeout: vi.fn(),
        registerCron: vi.fn(),
        cancelAll: vi.fn()
      } as any
    )
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  const createExtension = async (id: string, permissions: string[], scriptContent: string) => {
    const manifest = {
      id,
      version: '1.0.0',
      apiVersion: '1',
      name: 'Test Ext',
      description: 'test',
      main: 'index.js',
      permissions
    }
    
    const zip = new AdmZip()
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
    zip.addFile('index.js', Buffer.from(scriptContent))
    const zipPath = path.join(tmpDir, `${id}.scext`)
    zip.writeZip(zipPath)

    return zipPath
  }

  it('Phase 6 Testable Checkpoint: Resolve names and query chat list', async () => {
    const zipPath = await createExtension('test-ext-phase06', ['contacts:read', 'chats:read'], `
      module.exports = async function(ctx) {
        ctx.onActivate(async () => {
          const selfJid = await ctx.contacts.getSelfJid()
          ctx.log.info('I am', selfJid)
        
          const chats = await ctx.chats.list(5)
          ctx.log.info('Top 5 chats:', chats.map(c => c.name).join(', '))
        })
      }
    `)

    const loader = (host as any).loader as ExtensionLoader
    await loader.install(zipPath)
    await host.load('test-ext-phase06')

    const logContent = fs.readFileSync(path.join(tmpDir, 'test-ext-phase06', 'ext.log'), 'utf8')
    expect(logContent).toContain('I am 1234567890@s.whatsapp.net')
    expect(logContent).toContain('Top 5 chats: Alice, Bob')
  })
})
