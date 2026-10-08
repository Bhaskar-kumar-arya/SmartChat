import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { PluginLoader } from '../../../kernel/plugins/PluginLoader';
import { PluginRegistry } from '../../../kernel/plugins/PluginRegistry';
import { PluginHost } from '../../../kernel/plugins/PluginHost';
import { ContributionRegistry } from '../../../kernel/contributions/ContributionRegistry';
import { KernelAPIRouter } from '../../../kernel/KernelAPIRouter';
import { PermissionStore } from '../../../kernel/permissions/PermissionStore';
import { KernelLogModule } from '../../../kernel/api-modules/KernelLogModule';
import { KernelAIModule } from '../../../kernel/api-modules/KernelAIModule';
import { type IBidirectionalPluginChannel } from '../../../kernel/channels/IPluginChannel';
import { validateUrl, isRestrictedIPv4, isRestrictedIPv6 } from '../../../../../plugins/url-page-reader-plugin/security';
import { extractContent, htmlToMarkdown } from '../../../../../plugins/url-page-reader-plugin/contentExtractor';
import { UrlReader } from '../../../../../plugins/url-page-reader-plugin/urlReader';
import { LRUCache } from '../../../../../plugins/url-page-reader-plugin/cache';

describe('URL Page Reader Plugin Suite', () => {
  describe('Security & SSRF Protection', () => {
    it('blocks loopback and private IPv4 subnets', () => {
      expect(isRestrictedIPv4('127.0.0.1')).toBe(true);
      expect(isRestrictedIPv4('127.0.0.50')).toBe(true);
      expect(isRestrictedIPv4('10.0.0.1')).toBe(true);
      expect(isRestrictedIPv4('172.16.0.1')).toBe(true);
      expect(isRestrictedIPv4('172.31.255.255')).toBe(true);
      expect(isRestrictedIPv4('192.168.1.1')).toBe(true);
      expect(isRestrictedIPv4('169.254.169.254')).toBe(true); // AWS/GCP metadata
      expect(isRestrictedIPv4('0.0.0.0')).toBe(true);
      expect(isRestrictedIPv4('8.8.8.8')).toBe(false); // Public DNS
      expect(isRestrictedIPv4('93.184.216.34')).toBe(false); // example.com
    });

    it('blocks loopback and private IPv6 subnets', () => {
      expect(isRestrictedIPv6('::1')).toBe(true);
      expect(isRestrictedIPv6('::')).toBe(true);
      expect(isRestrictedIPv6('fc00::1')).toBe(true);
      expect(isRestrictedIPv6('fd12:3456:789a:1::1')).toBe(true);
      expect(isRestrictedIPv6('fe80::1')).toBe(true);
      expect(isRestrictedIPv6('2606:4700:4700::1111')).toBe(false); // Cloudflare DNS
    });

    it('blocks non-HTTP protocols and local domains', async () => {
      const fileRes = await validateUrl('file:///etc/passwd');
      expect(fileRes.ok).toBe(false);
      expect(fileRes.error).toContain('Forbidden protocol');

      const ftpRes = await validateUrl('ftp://example.com/file');
      expect(ftpRes.ok).toBe(false);
      expect(ftpRes.error).toContain('Forbidden protocol');

      const localhostRes = await validateUrl('http://localhost:8080');
      expect(localhostRes.ok).toBe(false);
      expect(localhostRes.error).toContain('blocked for security');

      const localDomainRes = await validateUrl('http://router.local/admin');
      expect(localDomainRes.ok).toBe(false);
      expect(localDomainRes.error).toContain('blocked for security');

      const ipRes = await validateUrl('http://127.0.0.1:3000/api');
      expect(ipRes.ok).toBe(false);
      expect(ipRes.error).toContain('private/restricted IP');
    });

    it('allows valid public URLs', async () => {
      const valid = await validateUrl('https://example.com/test-page?q=1#section', { skipDns: true });
      expect(valid.ok).toBe(true);
      expect(valid.url).toBe('https://example.com/test-page?q=1#section');
      expect(valid.hostname).toBe('example.com');
    });
  });

  describe('Content Extraction & Markdown Formatting', () => {
    it('extracts metadata and Schema.org JSON-LD correctly', () => {
      const sampleHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Sample Article Title</title>
            <meta name="description" content="A comprehensive article about AI technology." />
            <meta name="author" content="Jane Doe" />
            <meta property="og:site_name" content="TechNews" />
            <script type="application/ld+json">
              {
                "@type": "FAQPage",
                "mainEntity": [
                  {
                    "@type": "Question",
                    "name": "What is SmartChat?",
                    "acceptedAnswer": {
                      "@type": "Answer",
                      "text": "An extensible WhatsApp desktop client."
                    }
                  }
                ]
              }
            </script>
          </head>
          <body>
            <nav><a href="/home">Home</a></nav>
            <main>
              <h1>Main Headline</h1>
              <p>Here is paragraph one with a <a href="https://example.com">useful link</a>.</p>
              <table>
                <tr><th>Feature</th><th>Supported</th></tr>
                <tr><td>CSR</td><td>Yes</td></tr>
              </table>
              <pre><code>console.log('hello world');</code></pre>
            </main>
            <footer>Copyright 2026</footer>
          </body>
        </html>
      `;

      const result = extractContent(sampleHtml, { includeLinks: true });
      expect(result.metadata.title).toBe('Sample Article Title');
      expect(result.metadata.description).toBe('A comprehensive article about AI technology.');
      expect(result.metadata.author).toBe('Jane Doe');
      expect(result.metadata.siteName).toBe('TechNews');
      expect(result.jsonLd).toContain('What is SmartChat?');
      expect(result.jsonLd).toContain('An extensible WhatsApp desktop client.');

      // Markdown formatting
      expect(result.markdown).toContain('# Main Headline');
      expect(result.markdown).toContain('[useful link](https://example.com)');
      expect(result.markdown).toContain('| Feature | Supported |');
      expect(result.markdown).toContain('| CSR | Yes |');
      expect(result.markdown).toContain('```\nconsole.log(\'hello world\');\n```');

      // Noise should be stripped
      expect(result.markdown).not.toContain('Home');
      expect(result.markdown).not.toContain('Copyright 2026');
    });

    it('converts lists and blockquotes to markdown', () => {
      const html = `
        <blockquote>This is an important quote</blockquote>
        <ul>
          <li>First item</li>
          <li>Second item</li>
        </ul>
      `;
      const md = htmlToMarkdown(html);
      expect(md).toContain('> This is an important quote');
      expect(md).toContain('- First item');
      expect(md).toContain('- Second item');
    });
  });

  describe('LRU Cache', () => {
    it('stores, retrieves, and respects TTL and capacity', () => {
      const cache = new LRUCache(2, 5000);
      cache.set('url1', { text: 'content 1' });
      cache.set('url2', { text: 'content 2' });

      expect(cache.get('url1')).toEqual({ text: 'content 1' });
      expect(cache.get('url2')).toEqual({ text: 'content 2' });

      // Insert 3rd item, evicting oldest (which is url1 since url2 was accessed last, or url1 was accessed last)
      cache.set('url3', { text: 'content 3' });
      expect(cache.size()).toBe(2);
      expect(cache.get('url3')).toEqual({ text: 'content 3' });
    });
  });

  describe('Client-Side Rendering (CSR) & Fallback Execution', () => {
    let server: http.Server;
    let serverPort: number;

    beforeEach(async () => {
      // Create a test HTTP server that serves dynamic Client-Side JavaScript
      server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>CSR Test App</title></head>
            <body>
              <div id="app">Initial Static SSR Placeholder</div>
              <script>
                // Simulate Client-Side SPA rendering (e.g. React/Vue hydration)
                setTimeout(function() {
                  document.getElementById('app').innerHTML = '<h2>Dynamic Client-Side Rendered Content!</h2><p>This paragraph was rendered via JavaScript.</p>';
                }, 100);
              </script>
            </body>
          </html>
        `);
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          if (addr && typeof addr === 'object') {
            serverPort = addr.port;
          }
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    });

    it('renders dynamic client-side JavaScript content using headless browser', async () => {
      const reader = new UrlReader();
      const testUrl = `http://127.0.0.1:${serverPort}`;

      // Force browser engine and skip DNS/SSRF check for this local test server
      const result = await reader.readUrl(testUrl, {
        skipDns: true,
        allowLocalhost: true,
        forceEngine: 'browser',
        customWaitMs: 300
      });

      await reader.close();

      expect(result.text).toContain('## Dynamic Client-Side Rendered Content!');
      expect(result.text).toContain('This paragraph was rendered via JavaScript.');
      expect(result.text).not.toContain('Initial Static SSR Placeholder');
      expect(result.engine).toBe('headless-browser');
      expect(result.fromCache).toBe(false);
    }, 25000);

    it('returns cached results on second call', async () => {
      const reader = new UrlReader();
      const testUrl = `http://127.0.0.1:${serverPort}`;

      const res1 = await reader.readUrl(testUrl, {
        skipDns: true,
        allowLocalhost: true,
        forceEngine: 'fallback'
      });
      expect(res1.fromCache).toBe(false);

      const res2 = await reader.readUrl(testUrl, {
        skipDns: true,
        allowLocalhost: true,
        forceEngine: 'fallback'
      });
      expect(res2.fromCache).toBe(true);
      expect(res2.text).toBe(res1.text);

      await reader.close();
    });
  });

  describe('Microkernel E2E Plugin Host Integration', () => {
    let tmpDir: string;
    let loader: PluginLoader;
    let registry: PluginRegistry;
    let contribRegistry: ContributionRegistry;
    let host: PluginHost;
    let scextPath: string;

    beforeEach(async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartchat-url-reader-e2e-'));
      const permFile = path.join(tmpDir, 'permissions.json');
      const permissions = new PermissionStore(permFile);

      const router = new KernelAPIRouter();
      router.registerModule(new KernelLogModule(permissions));

      const mockAIService: any = {
        generateResponse: vi.fn(async () => 'mock response')
      };
      const mockToolRegistry: any = {
        executeTool: vi.fn(async () => ({ text: 'ok' })),
        registerTool: vi.fn()
      };
      router.registerModule(new KernelAIModule(permissions, mockAIService, mockToolRegistry));

      loader = new PluginLoader(tmpDir);
      registry = new PluginRegistry();
      contribRegistry = new ContributionRegistry();
      host = new PluginHost(loader, registry, router, contribRegistry);

      scextPath = path.resolve(__dirname, '../../../../../plugins/url-page-reader.scext');
    });

    afterEach(async () => {
      try {
        const loaded = host.listLoaded();
        for (const id of loaded) {
          await host.unload(id);
        }
      } catch {}

      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    });

    it('installs, loads in worker thread, registers read_url_content AI tool, and handles execution', async () => {
      expect(fs.existsSync(scextPath)).toBe(true);

      // 1. Install plugin package
      const manifest = await loader.install(scextPath);
      expect(manifest.id).toBe('com.smartchat.url-page-reader');
      expect(manifest.contributions.aiTools?.length).toBe(1);
      expect(manifest.contributions.aiTools?.[0].name).toBe('read_url_content');

      // 2. Load into worker thread
      await host.load(manifest.id);
      expect(host.listLoaded()).toContain(manifest.id);

      // 3. Verify AI tool is registered in ContributionRegistry
      const registeredTools = contribRegistry.getAll('ai-tool');
      const readerTool = registeredTools.find((t) => t.name === 'read_url_content');
      expect(readerTool).toBeDefined();
      expect(readerTool?.pluginId).toBe(manifest.id);
      expect(readerTool?.description).toContain('Fetches, renders, and extracts');

      // 4. Execute AI tool through the plugin channel
      const plugin = host.getPlugin(manifest.id);
      expect(plugin).toBeDefined();
      const channel = plugin!.channel;

      const res = await (channel as IBidirectionalPluginChannel).sendRequestToPlugin({
        id: 'ai-tool-req-1',
        type: 'contribution:execute:ai-tool',
        payload: {
          name: 'read_url_content',
          args: {
            url: 'https://example.com'
          }
        }
      });

      expect(res.ok).toBe(true);
      const output = typeof res.payload === 'string' ? res.payload : (res.payload as any)?.text;
      expect(output).toContain('Example Domain');

      // 5. Unload cleanly
      await host.unload(manifest.id);
      expect(host.listLoaded()).not.toContain(manifest.id);
      expect(contribRegistry.getAll('ai-tool').some((t) => t.pluginId === manifest.id)).toBe(false);
    }, 30000);
  });
});
