import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { glassDefaults } from './scripts/glass-defaults'

// Local archival sources must never be exposed by either preview server.
function privateArchive(): Plugin {
  const install = (server: { middlewares: { use: (handler: (req: { url?: string }, res: { statusCode: number; end: (text: string) => void }, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      let path: string
      try { path = decodeURIComponent((req.url || '/').split('?')[0]) } catch { res.statusCode = 400; res.end('Bad request'); return }
      if (/(^|\/)(writing|original-site|christmas)(?:\/|$)|(^|\/)wake-up-claude\.html$/i.test(path)) {
        res.statusCode = 404
        res.end('Not found')
        return
      }
      next()
    })
  }
  return { name: 'private-original-site', configureServer: install, configurePreviewServer: install }
}

export default defineConfig({
  plugins: [privateArchive(), glassDefaults(), react(), tailwindcss()],
  server: { fs: { strict: true, deny: ['**/original-site/**', '**/.env*', '**/.git/**'] } },
  build: { sourcemap: false },
})
