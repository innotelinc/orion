import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites from /<repo>/, so the asset base has to
// follow the repository name there. Local dev and the container serve from /.
const repository = process.env.GITHUB_REPOSITORY
const base = repository ? `/${repository.split('/')[1]}/` : '/'

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    // `npm run dev` talks to `node server/index.mjs` on the port it listens on,
    // so the dev build is live against the same host API as the container.
    proxy: {
      '/api': {
        target: process.env.ORION_API ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
