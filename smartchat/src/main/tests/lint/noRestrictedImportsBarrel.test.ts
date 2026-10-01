import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'
import { resolve } from 'path'

// G-05: the no-restricted-imports rule must flag the main `utils` barrel (src/main/utils.ts)
// but not legitimate sibling-file imports such as `utils/logger`.
const root = resolve(__dirname, '../../../..')
const eslint = new ESLint({ cwd: root, overrideConfigFile: resolve(root, 'eslint.config.mjs') })

async function restrictedCount(source: string): Promise<number> {
  const [res] = await eslint.lintText(source, { filePath: resolve(root, 'src/main/sample.ts') })
  return res.messages.filter((m) => m.ruleId === 'no-restricted-imports').length
}

describe('no-restricted-imports (utils barrel)', () => {
  it.each(['../utils', './utils', '../../utils', '../utils.ts', 'utils'])(
    'flags barrel import %s',
    async (spec) => {
      expect(await restrictedCount(`import x from '${spec}'\nexport default x\n`)).toBe(1)
    }
  )

  it.each([
    '../utils/logger',
    './utils/guestPreload',
    '../utils/jidUtils',
    '../utils/workerUtils',
    '@electron-toolkit/utils',
    '../myutils'
  ])('allows %s', async (spec) => {
    expect(await restrictedCount(`import x from '${spec}'\nexport default x\n`)).toBe(0)
  })
})
