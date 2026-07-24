import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/main/tests/setup.ts'],
    include: ['src/main/tests/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    server: {
      deps: {
        inline: ['@electron-toolkit/utils']
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      'electron': resolve(__dirname, './src/main/tests/electron-mock.ts')
    }
  }
})
