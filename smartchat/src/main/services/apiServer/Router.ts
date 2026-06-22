import http from 'http'

export type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => void | Promise<void>

export type Middleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void | Promise<void>
) => void | Promise<void>

interface Route {
  method: string
  path: string
  handler: RouteHandler
}

/**
 * A lightweight, zero-dependency middleware router for Node's http.Server.
 * Follows Open/Closed Principle to allow dynamic route and middleware registrations.
 */
export class Router {
  private readonly routes: Route[] = []
  private readonly middlewares: Middleware[] = []

  use(middleware: Middleware): void {
    this.middlewares.push(middleware)
  }

  get(path: string, handler: RouteHandler): void {
    this.routes.push({ method: 'GET', path, handler })
  }

  post(path: string, handler: RouteHandler): void {
    this.routes.push({ method: 'POST', path, handler })
  }

  options(path: string, handler: RouteHandler): void {
    this.routes.push({ method: 'OPTIONS', path, handler })
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`)
    const pathname = parsedUrl.pathname
    const method = req.method || 'GET'

    let index = 0

    const next = async (): Promise<void> => {
      if (index < this.middlewares.length) {
        const middleware = this.middlewares[index++]
        await middleware(req, res, next)
      } else {
        const route = this.routes.find((r) => r.method === method && r.path === pathname)
        if (route) {
          await route.handler(req, res)
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: `Not Found: ${method} ${pathname}` }))
        }
      }
    }

    await next()
  }
}
