// vite.config.ts

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  // относительные пути к ассетам: сборка не зависит от того, под каким адресом её отдаёт Electron
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@neko': path.resolve(__dirname, './src/neko'),
      '@aria': path.resolve(__dirname, './src/aria'),
    },
  },
  build: {
    // Electron 29 = Chromium 122: транспилировать «под старые браузеры» незачем, код короче и быстрее
    target: 'chrome122',
    chunkSizeWarningLimit: 1200, // three.js сам по себе тяжёлый
    rollupOptions: {
      input: {
        neko: path.resolve(__dirname, 'src/neko/index.html'),
        aria: path.resolve(__dirname, 'src/aria/index.html'),
      },
    },
  },
  // Electron открывает именно 5173 — при занятом порте лучше упасть, чем тихо переехать на 5174
  server: { port: 5173, strictPort: true },
})
