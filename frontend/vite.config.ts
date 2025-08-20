import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/assistant': 'http://localhost:8080',
      '/process': 'http://localhost:8080',
      '/health': 'http://localhost:8080'
    }
  }
})


