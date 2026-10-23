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
  },
})
