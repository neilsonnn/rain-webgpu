import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { glassDefaults } from './scripts/glass-defaults'

export default defineConfig({
  base: './',
  plugins: [glassDefaults(), react()],
  server: { fs: { strict: true, deny: ['**/.env*', '**/.git/**'] } },
  build: { sourcemap: false },
})
