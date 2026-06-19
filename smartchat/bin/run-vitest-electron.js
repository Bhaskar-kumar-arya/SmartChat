const { spawn } = require('child_process')
const path = require('path')
const electronPath = require('electron')

// Construct path to vitest CLI script
const vitestPath = path.join(__dirname, '../node_modules/vitest/vitest.mjs')

// Forward all command line arguments to vitest
const args = [vitestPath, ...process.argv.slice(2)]

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1'
  }
})

child.on('close', (code) => {
  process.exit(code || 0)
})
