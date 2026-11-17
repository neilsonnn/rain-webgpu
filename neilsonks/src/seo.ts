import metadata from './seo.json'
import type { Page } from './store'

export function updatePageMetadata(page: Page) {
  const details = page === 'not-found'
    ? { title: 'Page not found — Neilson Koerner-Safrata', description: 'Page not found.' }
    : metadata[page]
  const meta = (attribute: 'name' | 'property', key: string, content: string) => {
    let element = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
    if (!element) { element = document.createElement('meta'); element.setAttribute(attribute, key); document.head.appendChild(element) }
    element.content = content
  }
  meta('name', 'description', details.description)
  meta('property', 'og:title', details.title)
  meta('property', 'og:description', details.description)
  meta('name', 'twitter:title', details.title)
  meta('name', 'twitter:description', details.description)
  meta('name', 'robots', page === 'not-found' ? 'noindex, follow' : 'index, follow')
  let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (page === 'not-found') {
    canonical?.remove()
    document.querySelector('meta[property="og:url"]')?.remove()
  } else {
    const url = 'https://neilsonks.com' + metadata[page].path
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical) }
    canonical.href = url
    meta('property', 'og:url', url)
  }
}
