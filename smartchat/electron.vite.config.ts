import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['@prisma/client', '@whiskeysockets/baileys'],
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'embedding.worker': resolve(__dirname, 'src/main/workers/embedding.worker.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
