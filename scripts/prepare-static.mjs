import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

// Preserve existing /glass/ bookmarks on static hosts as well as the new root.
mkdirSync('dist/glass', { recursive: true })
const page = readFileSync('dist/index.html', 'utf8')
writeFileSync('dist/glass/index.html', page.replace('<head>', '<head>\n  <base href="../" />'))
for (const asset of [
  'audio/rain-tin-roof.mp3', 'audio/rain-on-glass.mp3', 'images/glass/reference.png',
  'images/glass/opening-wide.avif', 'images/glass/opening-portrait.avif',
  'images/glass/opening-wide-small.avif', 'images/glass/opening-portrait-small.avif',
  'images/glass/opening-wide-small.webp', 'images/glass/opening-portrait-small.webp',
]) {
  assert(existsSync(`dist/${asset}`), `Missing glass asset: ${asset}`)
}
console.log('Prepared standalone glass pages and assets.')
