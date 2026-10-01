import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'http'
import net from 'net'
import type { AddressInfo } from 'net'
import { APIServer } from '../../../services/apiServer/APIServer'
import { IAPIConfigProvider } from '../../../services/apiServer/IAPIConfigProvider'
import { IToolRegistry } from '../../../services/ai/IToolRegistry'
import { IChatService } from '../../../services/chats/IChatService'
import { IMessageActionService } from '../../../services/messages/IMessageActionService'
import { WASocket } from '../../../services/whatsapp/types'

const TOKEN = 'real-http-test-token'

/** Ask the OS for a currently free loopback port (no fixed ports in tests). */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

interface HttpResult {
  status: number
  body: string
}

function request(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      )
    })
    req.on('error', reject)
    req.end()
  })
}

async function waitListening(port: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.connect(port, '127.0.0.1')
      s.once('connect', () => {
        s.destroy()
        resolve(true)
      })
      s.once('error', () => resolve(false))
    })
    if (ok) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('server did not start listening')
}

function makeServer(port: number): APIServer {
  const configProvider = {
    loadOrCreateConfig: vi.fn().mockReturnValue({ port, token: TOKEN })
  } as unknown as IAPIConfigProvider
  const toolRegistry = { getToolDefinitions: vi.fn().mockReturnValue([]) } as unknown as IToolRegistry
  return new APIServer(
    configProvider,
    toolRegistry,
    {} as unknown as IChatService,
    {} as unknown as IMessageActionService,
    (): WASocket | null => null
  )
}

describe('APIServer (real http, ephemeral port)', () => {
  let api: APIServer
  let port: number

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    port = await getFreePort()
    api = makeServer(port)
    api.start()
    await waitListening(port)
  })

  afterEach(async () => {
    await api.stop()
    vi.restoreAllMocks()
  })

  it('rejects requests without an Authorization header with 401', async () => {
    const res = await request(port, 'GET', '/api/status')
    expect(res.status).toBe(401)
    expect(JSON.parse(res.body).error).toMatch(/Missing or invalid token format/)
  })

  it('rejects a non-Bearer scheme with 401', async () => {
    const res = await request(port, 'GET', '/api/status', { Authorization: `Basic ${TOKEN}` })
    expect(res.status).toBe(401)
    expect(JSON.parse(res.body).error).toMatch(/Missing or invalid token format/)
  })

  it('rejects a wrong token with 401', async () => {
    const res = await request(port, 'GET', '/api/status', { Authorization: 'Bearer nope' })
    expect(res.status).toBe(401)
    expect(JSON.parse(res.body).error).toMatch(/Invalid token/)
  })

  it('rejects a token that differs only in length with 401', async () => {
    const res = await request(port, 'GET', '/api/status', { Authorization: `Bearer ${TOKEN}x` })
    expect(res.status).toBe(401)
  })

  it('accepts the correct token and serves /api/status', async () => {
    const res = await request(port, 'GET', '/api/status', { Authorization: `Bearer ${TOKEN}` })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ status: 'running', port, whatsappConnected: false })
  })

  it('returns 404 for an unknown route when authenticated', async () => {
    const res = await request(port, 'GET', '/api/nope', { Authorization: `Bearer ${TOKEN}` })
    expect(res.status).toBe(404)
  })

  it('answers OPTIONS with 204 and no body, without auth', async () => {
    const res = await request(port, 'OPTIONS', '/api/status')
    expect(res.status).toBe(204)
    expect(res.body).toBe('')
  })
})

describe('APIServer listen errors', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.fails('attaches an error listener so listen failures are not unhandled (B-APP-07)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const createSpy = vi.spyOn(http, 'createServer')
    const port = await getFreePort()
    const api = makeServer(port)
    api.start()
    try {
      const created = createSpy.mock.results[0].value as http.Server
      expect(created.listenerCount('error')).toBeGreaterThan(0)
    } finally {
      await api.stop()
    }
  })
})
