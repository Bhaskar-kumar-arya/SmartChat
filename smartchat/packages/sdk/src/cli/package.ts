#!/usr/bin/env node

import * as fs from 'fs'
import * as path from 'path'
import AdmZip from 'adm-zip'
import { validateManifest } from '../manifest'

export async function packagePlugin(options?: { pluginDir?: string; outPath?: string }): Promise<string> {
  const pluginDir = path.resolve(options?.pluginDir || process.cwd())
  const manifestPath = path.join(pluginDir, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found at ${manifestPath}`)
  }

  let manifestRaw: unknown
  try {
    manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new Error(`Invalid JSON in manifest.json at ${manifestPath}`)
  }

  const manifest = validateManifest(manifestRaw)

  const entryPath = path.join(pluginDir, manifest.main)
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Plugin entry point file specified in manifest.main not found at ${entryPath}`)
  }

  // Copy @smartchat/sdk dist and zod into plugin's node_modules if present in monorepo
  const sdkSourceDir = path.resolve(__dirname, '../..')
  const sdkTargetDir = path.join(pluginDir, 'node_modules/@smartchat/sdk')

  if (fs.existsSync(path.join(sdkSourceDir, 'dist')) && fs.existsSync(path.join(sdkSourceDir, 'package.json'))) {
    fs.mkdirSync(sdkTargetDir, { recursive: true })
    fs.cpSync(path.join(sdkSourceDir, 'dist'), path.join(sdkTargetDir, 'dist'), { recursive: true })
    fs.copyFileSync(path.join(sdkSourceDir, 'package.json'), path.join(sdkTargetDir, 'package.json'))
  }

  const rootZodDir = path.resolve(__dirname, '../../../../node_modules/zod')
  const targetZodDir = path.join(pluginDir, 'node_modules/zod')
  if (fs.existsSync(rootZodDir) && !fs.existsSync(targetZodDir)) {
    fs.mkdirSync(targetZodDir, { recursive: true })
    fs.cpSync(rootZodDir, targetZodDir, { recursive: true })
  }

  const outputPath = options?.outPath
    ? path.resolve(options.outPath)
    : path.join(pluginDir, '..', `${manifest.id.split('.').pop() || manifest.id}.scext`)

  const zip = new AdmZip()

  zip.addFile('manifest.json', fs.readFileSync(manifestPath))
  zip.addFile(manifest.main, fs.readFileSync(entryPath))

  const pkgPath = path.join(pluginDir, 'package.json')
  if (fs.existsSync(pkgPath)) {
    zip.addFile('package.json', fs.readFileSync(pkgPath))
  }

  const panelDir = path.join(pluginDir, 'panel')
  if (fs.existsSync(panelDir)) {
    zip.addLocalFolder(panelDir, 'panel')
  }

  const nodeModulesPath = path.join(pluginDir, 'node_modules')
  if (fs.existsSync(nodeModulesPath)) {
    zip.addLocalFolder(nodeModulesPath, 'node_modules')
  }

  zip.writeZip(outputPath)
  return outputPath
}

// CLI runner
if (require.main === module) {
  const args = process.argv.slice(2)
  let pluginDir: string | undefined
  let outPath: string | undefined

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--dir' || args[i] === '-d') && args[i + 1]) {
      pluginDir = args[++i]
    } else if ((args[i] === '--out' || args[i] === '-o') && args[i + 1]) {
      outPath = args[++i]
    }
  }

  packagePlugin({ pluginDir, outPath })
    .then((createdPath) => {
      console.log(`[smartchat-sdk] Successfully packaged plugin: ${createdPath}`)
    })
    .catch((err) => {
      console.error(`[smartchat-sdk] Packaging failed: ${err.message}`)
      process.exit(1)
    })
}
