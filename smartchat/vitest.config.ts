import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
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
      },
      {
        test: {
          name: 'renderer',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./src/renderer/tests/setup.ts'],
          include: ['src/renderer/tests/**/*.{test,spec}.{ts,tsx}'],
          testTimeout: 15000,
          hookTimeout: 30000
        },
        resolve: {
          alias: {
            '@renderer': resolve(__dirname, './src/renderer/src'),
            '@': resolve(__dirname, './src'),
            'electron': resolve(__dirname, './src/main/tests/electron-mock.ts')
          }
        }
      },
      {
        test: {
          name: 'sdk',
          globals: true,
          environment: 'node',
          include: ['packages/sdk/tests/**/*.test.ts'],
          testTimeout: 15000
        }
      }
    ]
  }
})

