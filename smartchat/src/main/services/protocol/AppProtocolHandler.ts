import { net } from 'electron';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { ISecureFileRegistry } from './ISecureFileRegistry';

export class AppProtocolHandler {
  constructor(
    private readonly registry: ISecureFileRegistry,
    private readonly devServerUrl: string = 'http://localhost:5173'
  ) {}

  public async handleRequest(request: Request): Promise<Response> {
    const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
    const allowedOrigin = isDev ? this.devServerUrl : 'app://-';

    // Handle CORS preflight request
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      });
    }

    try {
      const { host, pathname } = new URL(request.url);
      
      let filePath: string | null = null;

      if (host === 'local') {
        // For 'local', the pathname contains the absolute path
        const decodedPath = decodeURIComponent(pathname.startsWith('/') ? pathname.slice(1) : pathname);
        filePath = decodedPath;
      } else {
        filePath = this.registry.resolvePath(host, pathname);
      }

      if (filePath && fs.existsSync(filePath)) {
        const res = await net.fetch(pathToFileURL(filePath).href);
        const headers = new Headers(res.headers);
        headers.set('Access-Control-Allow-Origin', allowedOrigin);
        
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers
        });
      }
    } catch (err: unknown) {
      console.error('[AppProtocolHandler] Error handling request:', err);
    }
    
    return new Response('Not Found', { 
      status: 404,
      headers: { 'Access-Control-Allow-Origin': allowedOrigin }
    });
  }
}
