import { readFileSync, writeFileSync } from 'node:fs'
import { load } from 'cheerio'
const $ = load(readFileSync('original-site/index.html','utf8'))
const text = (el) => el.text().replace(/\s+/g,' ').trim()
const html = (el) => (el.html() || '').trim()
const projects = $('#content > .contentRow').toArray().map((node) => {
  const row = $(node), info = row.find('.contentInfo'), paragraphs = info.children('p')
  return { title: text(info.find('h1')), metadata: text(info.find('h2')), image: '/' + row.find('.gifDIV img').attr('src'), description: html(paragraphs.eq(0)), links: paragraphs.eq(1).find('a[href]').toArray().map(a => ({label:text($(a)),href:$(a).attr('href')})), details: html(info.find('.contentHidden')), video:row.find('iframe').attr('src') || null, hidden: /display:\s*none/.test(row.attr('style') || '') }
})
const about = $('#about > div').html().replace('He then moved to the Bay Area and worked at his first startup, creating animation systems for an interactive talking dog driven by realtime language models.', 'He then moved to the Bay Area, creating animation systems for an interactive talking dog driven by realtime language models.').replace(/<br\s*\/?\s*>/g,'').replace(/target="_blank"/g,'target="_blank" rel="noopener noreferrer"')
const b = load(readFileSync('original-site/reading/index.html','utf8'))
const shelves = b('.bookFlex').toArray().map(node => {
  const shelf = b(node)
  return {year:text(shelf.prevAll('.line').first().find('h1')), books:shelf.find('.book').toArray().map(book => {const item = b(book);return {title:text(item.find('h4')),author:text(item.find('h5')),image:'/reading/'+item.find('img, image').attr('src'),description:html(item.find('p:not(.quote)').first()),quotes:item.find('p.quote').toArray().map(q=>html(b(q))),featured:item.hasClass('scale')}})}
})
const groupedShelves = []
for (const shelf of shelves) {
  const existing = groupedShelves.find(group => group.year === shelf.year)
  if (existing) existing.books.push(...shelf.books)
  else groupedShelves.push(shelf)
}
writeFileSync('src/content.json',JSON.stringify({projects,about,shelves:groupedShelves},null,2)+'\n')
console.log(`Migrated ${projects.filter(p=>!p.hidden).length} visible projects, ${projects.filter(p=>p.hidden).length} archived projects, ${groupedShelves.reduce((n,s)=>n+s.books.length,0)} books.`)
