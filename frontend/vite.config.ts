import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // 代理 WebSocket 连接
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true,
      },
      // 代理 HTTP API
      '/roles': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
