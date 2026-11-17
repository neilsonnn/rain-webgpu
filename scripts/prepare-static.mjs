import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'

// Preserve existing /glass/ bookmarks on static hosts as well as the new root.
mkdirSync('dist/glass', { recursive: true })
copyFileSync('dist/index.html', 'dist/glass/index.html')
for (const asset of ['audio/rain-tin-roof.mp3', 'audio/rain-on-glass.mp3', 'images/glass/reference.png']) {
  assert(existsSync(`dist/${asset}`), `Missing glass asset: ${asset}`)
}
console.log('Prepared standalone glass pages and assets.')
