import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import assert from 'node:assert/strict'
import { load } from 'cheerio'
const metadata = JSON.parse(readFileSync('src/seo.json', 'utf8'))
const template = readFileSync('dist/index.html', 'utf8')
const origin = 'https://neilsonks.com'
// Real entry files keep the original URLs usable on ordinary static hosts.
for (const [file, page] of Object.entries({ 'index.html': 'chess', 'chess/index.html': 'chess', 'city/index.html': 'city', 'glass/index.html': 'glass', 'work/index.html': 'work', 'about/index.html': 'about', 'info/index.html': 'about', 'reading/index.html': 'books', 'books/index.html': 'books', '404.html': 'not-found' })) {
  const $ = load(template)
  if (page === 'glass') $('html').attr('data-theme', 'glass')
  const details = page === 'not-found' ? { title: 'Page not found — Neilson Koerner-Safrata', description: 'Page not found.' } : metadata[page]
  $('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]').attr('content', details.description)
  $('meta[property="og:title"], meta[name="twitter:title"]').attr('content', details.title)
  if (page === 'not-found') {
    $('meta[name="robots"]').attr('content', 'noindex, follow')
    $('link[rel="canonical"], meta[property="og:url"]').remove()
  } else {
    const canonical = origin + details.path
    $('link[rel="canonical"]').attr('href', canonical)
    $('meta[property="og:url"]').attr('content', canonical)
    assert.equal($('link[rel="canonical"]').length, 1)
    assert.equal($('link[rel="canonical"]').attr('href'), canonical)
  }
  assert.equal($('title').text(), 'Neilson')
  assert.equal($('meta[name="description"]').attr('content'), details.description)
  assert.equal($('meta[name="twitter:site"]').attr('content'), '@neilsonks')
  mkdirSync(dirname(`dist/${file}`), { recursive: true })
  writeFileSync(`dist/${file}`, $.html())
}
const urls = Object.values(metadata).map(page => origin + page.path)
writeFileSync('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${url}</loc></url>`).join('\n')}\n</urlset>\n`)
writeFileSync('dist/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`)
const content = JSON.parse(readFileSync('src/content.json','utf8'))
const sentence = 'He then moved to the Bay Area, creating animation systems for an interactive talking dog driven by realtime language models.'
assert(content.about.includes(sentence),'About sentence must match the requested wording')
assert(!content.about.includes('worked at his first startup'),'Old About wording remains')
for (const file of ['NeilsonKoernerSafrata_Resume.pdf', 'webm/tendarLowRes.mp4', 'images/glass/reference.png']) {
  assert(existsSync(`dist/${file}`),`Missing reconciled live file: ${file}`)
}
for (const item of [...content.projects, ...content.shelves.flatMap(s=>s.books)]) {
  assert(existsSync('public'+decodeURIComponent(item.image)),`Missing media: ${item.image}`)
}
function walk(dir) { return readdirSync(dir).flatMap(name=>{const file=dir+'/'+name;return statSync(file).isDirectory()?walk(file):[file]}) }
for (const file of walk('dist')) {
  assert(!/(^|\/)(writing|original-site|christmas|ui)(\/|$)|(^|\/)wake-up-claude\.html$|(^|\/)NeilsonKoernerSafrata_Resume_original\.pdf$/.test(file),`Excluded content in build: ${file}`)
  assert(!/(^|\/)(\.DS_Store|\.gitattributes|Thumbs\.db|desktop\.ini)$|\.(php|ini|log|llc|bak|tmp|swp|swo)$/i.test(file),`Non-site file in build: ${file}`)
  assert(statSync(file).size > 0,`Empty file in build: ${file}`)
  if (/\.(html|js)$/.test(file)) {
    const text = readFileSync(file,'utf8')
    assert(!text.includes('autonomy-and-automation') && !text.includes('external-minds'),`Draft references leaked: ${file}`)
  }
}
console.log('Verified page metadata, sitemap, About copy, media, and exclusion of drafts, removed pages, obsolete UI, and non-site files.')
