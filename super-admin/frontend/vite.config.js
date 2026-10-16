import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// @app = componenti e lib di QUESTA app (Icon, Select, useApi...); @shared = shared/frontend/ alla radice del repo.
// Il Builder vive in shared/frontend/builder/ e prende dall'app solo ciò che ha lo stesso nome in entrambe.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@app': path.resolve(here, 'src'),
      '@shared': path.resolve(here, '../../shared/frontend'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    fs: { allow: [path.resolve(here, '../..')] },
    proxy: {
      '/api': 'http://localhost:3000'
    }
  },
})
