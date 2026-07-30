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
          'embedding.worker': resolve(__dirname, 'src/main/workers/embedding/embedding.worker.ts'),
          'whatsapp.worker': resolve(__dirname, 'src/main/workers/whatsapp/whatsapp.worker.ts')
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          'overlay-preload': resolve(__dirname, 'src/preload/overlay-preload.ts'),
          'panel-preload': resolve(__dirname, 'src/preload/panel-preload.ts')
        }
      }
    }
  },

  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
