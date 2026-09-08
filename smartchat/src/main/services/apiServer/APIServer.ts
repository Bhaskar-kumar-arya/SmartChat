import http from 'http'
import crypto from 'crypto'
import { IAPIServer } from './IAPIServer'
import { IAPIConfigProvider } from './IAPIConfigProvider'
import { Router } from './Router'
import { StatusController } from './controllers/StatusController'
import { ToolsController } from './controllers/ToolsController'
import { ChatsController } from './controllers/ChatsController'
import { IToolRegistry } from '../ai/IToolRegistry'
import { IChatService } from '../chats/IChatService'
import { IMessageActionService } from '../messages/IMessageActionService'
import { WASocket } from '../whatsapp/types'

/**
 * Exposes core WhatsApp and database search operations to local programs.
 * Uses a modular Router registry and separates configurations/controllers.
 */
export class APIServer implements IAPIServer {
  private server: http.Server | null = null
  private readonly port: number
  private readonly token: string
  private readonly router: Router = new Router()

  constructor(
    private readonly configProvider: IAPIConfigProvider,
    private readonly toolRegistry: IToolRegistry,
    private readonly chatService: IChatService,
    private readonly messageActionService: IMessageActionService,
    private readonly getSock: () => WASocket | null
  ) {
    const config = this.configProvider.loadOrCreateConfig()
    this.port = config.port
    this.token = config.token
    this.setupRoutes()
  }

  private setupRoutes(): void {
    const statusController = new StatusController(this.getSock, this.port)
    const toolsController = new ToolsController(this.toolRegistry)
    const chatsController = new ChatsController(this.chatService, this.messageActionService, this.getSock)

    // 1. CORS Middleware
    // P2-S11-10: this is a credential-bearing API bound to 127.0.0.1 for local
    // programs (curl / native helpers), which do not enforce CORS. Replying
    // `Access-Control-Allow-Origin: *` only served to let arbitrary web pages
    // the user visits read the responses if they ever learned the token. No
    // ACAO header is sent, so browsers cannot read cross-origin responses.
    this.router.use((req, res, next) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }
      return next()
    })

    // 2. Authentication Middleware
    this.router.use((req, res, next) => {
      const authHeader = req.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        this.sendJSON(res, 401, { error: 'Unauthorized: Missing or invalid token format' })
        return
      }

      const reqToken = authHeader.substring(7).trim()
      if (!APIServer.tokensMatch(reqToken, this.token)) {
        this.sendJSON(res, 401, { error: 'Unauthorized: Invalid token' })
        return
      }
      return next()
    })

    // 3. Register Routes
    this.router.get('/api/status', statusController.getStatus)
    this.router.get('/api/tools', toolsController.getTools)
    
    this.router.get('/api/chats', async (req, res) => {
      try {
        await chatsController.getChats(req, res)
      } catch (err) {
        this.handleUnhandledError(res, err)
      }
    })

    this.router.post('/api/tools/execute', toolsController.executeTool)
    this.router.post('/api/messages/send', chatsController.sendMessage)
  }

  start(): void {
    if (this.server) {
      console.warn('[APIServer] API Server is already running')
      return
    }

    this.server = http.createServer((req, res) => {
      this.router.handle(req, res).catch(err => this.handleUnhandledError(res, err))
    })

    this.server.listen(this.port, '127.0.0.1', () => {
      console.log(`[APIServer] Local HTTP API Server listening on http://127.0.0.1:${this.port}`)
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return
    return new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          console.error('[APIServer] Error stopping server:', err)
          reject(err)
        } else {
          console.log('[APIServer] Local HTTP API Server stopped')
          this.server = null
          resolve()
        }
      })
    })
  }

  getApiToken(): string {
    return this.token
  }

  getPort(): number {
    return this.port
  }

  // P2-S11-10: constant-time token comparison so response timing isn't a
  // (weak) oracle for guessing the bearer token byte by byte.
  private static tokensMatch(a: string, b: string): boolean {
    const bufA = Buffer.from(a)
    const bufB = Buffer.from(b)
    if (bufA.length !== bufB.length) return false
    return crypto.timingSafeEqual(bufA, bufB)
  }

  private handleUnhandledError(res: http.ServerResponse, err: unknown): void {
    console.error('[APIServer] Unhandled request error:', err)
    const errMsg = err instanceof Error ? err.message : String(err)
    this.sendJSON(res, 500, { error: `Internal Server Error: ${errMsg}` })
  }

  private sendJSON(res: http.ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }
}
