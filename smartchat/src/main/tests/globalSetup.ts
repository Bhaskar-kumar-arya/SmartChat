import { execFileSync, execSync } from 'child_process'
import { createHash } from 'crypto'
import { createRequire } from 'module'
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

/**
 * Runs once before any test worker starts (vitest `globalSetup`).
 *
 *  1. Builds @smartchat/sdk (packages/sdk/dist) so extracted plugins can `require` it.
 *  2. Packs the .scext test plugins into plugins/ (ignored by VCS) via the SDK packager,
 *     which also vendors the SDK + zod into each plugin's node_modules.
 *  3. Creates the template SQLite DB (B-DATA-07), keyed on a hash of schema.prisma so a
 *     schema change regenerates it, and so parallel workers never race on `db push`.
 */
const root = resolve(__dirname, '../../..')

const PLUGINS: Array<{ dir: string; out: string; rawZip?: boolean }> = [
  { dir: 'test-all-features-plugin', out: 'test-all-features.scext' },
  { dir: 'declarative-modal-test-plugin', out: 'declarative-modal-test.scext' },
  // Its manifest does not pass the SDK packager's validateManifest (pre-existing); pack it
  // like scripts/package-codetantra-otp-relay-plugin.js does (plain zip of the folder).
  { dir: 'codetantra-otp-relay-plugin', out: 'codetantra-otp-relay.scext', rawZip: true },
  { dir: 'voice-transcriber-plugin', out: 'voice-transcriber.scext' }
]

function buildSdk(): void {
  const requireFromRoot = createRequire(join(root, 'package.json'))
  const tsc = requireFromRoot.resolve('typescript/bin/tsc')
  execFileSync(process.execPath, [tsc, '-p', join(root, 'packages/sdk')], {
    cwd: root,
    stdio: 'inherit'
  })
}

async function packPlugins(): Promise<void> {
  const requireFromRoot = createRequire(join(root, 'package.json'))
  const { packagePlugin } = requireFromRoot(join(root, 'packages/sdk/dist/cli/package.js'))
  const AdmZip = requireFromRoot('adm-zip')
  for (const { dir, out, rawZip } of PLUGINS) {
    if (rawZip) {
      const pluginDir = join(root, 'plugins', dir)
      const sdkDir = join(root, 'packages/sdk')
      const target = join(pluginDir, 'node_modules/@smartchat/sdk')
      mkdirSync(target, { recursive: true })
      cpSync(join(sdkDir, 'dist'), join(target, 'dist'), { recursive: true })
      copyFileSync(join(sdkDir, 'package.json'), join(target, 'package.json'))
      const zodSrc = join(root, 'node_modules/zod')
      const zodDst = join(pluginDir, 'node_modules/zod')
      if (existsSync(zodSrc) && !existsSync(zodDst)) cpSync(zodSrc, zodDst, { recursive: true })
      const zip = new AdmZip()
      zip.addLocalFolder(pluginDir)
      zip.writeZip(join(root, 'plugins', out))
      continue
    }
    await packagePlugin({
      pluginDir: join(root, 'plugins', dir),
      outPath: join(root, 'plugins', out)
    })
  }
}

function ensureTemplateDb(): void {
  const schemaPath = join(root, 'prisma/schema.prisma')
  const templatePath = join(root, 'prisma/template-test.db')
  const hashPath = `${templatePath}.hash`
  const hash = createHash('sha256').update(readFileSync(schemaPath)).digest('hex')

  const current =
    existsSync(templatePath) && existsSync(hashPath) && readFileSync(hashPath, 'utf8').trim() === hash
  if (current) return

  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(templatePath + suffix, { force: true })
  }
  console.log('[Test GlobalSetup] Creating template SQLite database at', templatePath)
  execSync('npx prisma db push --accept-data-loss', {
    stdio: 'inherit',
    cwd: root,
    env: { ...process.env, DATABASE_URL: `file:${templatePath}` }
  })
  writeFileSync(hashPath, hash)
}

export default async function globalSetup(): Promise<void> {
  buildSdk()
  await packPlugins()
  ensureTemplateDb()
}
