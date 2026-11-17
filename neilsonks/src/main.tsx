import React, { useEffect, useRef, useLayoutEffect, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { ListIcon } from '@phosphor-icons/react/dist/csr/List'
import { XIcon } from '@phosphor-icons/react/dist/csr/X'
import { InstagramLogoIcon } from '@phosphor-icons/react/dist/csr/InstagramLogo'
import { XLogoIcon } from '@phosphor-icons/react/dist/csr/XLogo'
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown'
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play'
import content from './content.json'
import { useNavigation } from './store'
import { updatePageMetadata } from './seo'
import './style.css'
import { Books } from './components/Books'

const Chess = lazy(() => import('./chess/App'))
const City = lazy(() => import('./city/App'))
const Glass = lazy(() => import('./glass/App'))
const destinations = [{ page: 'chess', label: 'Chess', href: '/' }, { page: 'city', label: 'City', href: '/city/' }, { page: 'glass', label: 'Glass', href: '/glass/' }, { page: 'work', label: 'CV', href: '/work/' }, { page: 'about', label: 'About', href: '/about/' }, { page: 'books', label: 'Books', href: '/reading/' }] as const
function NavLinks() {
  const { page, navigate } = useNavigation()
  return <nav aria-label="Main navigation" className="flex flex-col gap-1 font-mono text-[17px]">
    {destinations.map(item => <a key={item.page} href={item.href} aria-current={page === item.page ? 'page' : undefined}
      onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(item.page) } }}
      className={`nav-link py-2 ${page === item.page ? 'font-semibold' : ''}`}>{item.label}</a>)}
  </nav>
}
function SocialLinks() {
  return <div className="flex items-center gap-4">
    <a aria-label="Neilson on X" href="https://twitter.com/neilsonks" target="_blank" rel="noopener noreferrer" className="social-link"><XLogoIcon size={18} /></a>
    <a aria-label="Neilson on Instagram" href="https://www.instagram.com/neilsonnnnnnnn/" target="_blank" rel="noopener noreferrer" className="social-link"><InstagramLogoIcon size={20} /></a>
  </div>
}
function Navigation() {
  const { page, menuOpen, toggleMenu, closeMenu, navigate } = useNavigation()
  const menuRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && menuOpen) { closeMenu(); toggleRef.current?.focus() } }
    const onPointer = (event: PointerEvent) => { if (menuOpen && !menuRef.current?.contains(event.target as Node)) closeMenu() }
    const media = window.matchMedia('(min-width: 768px)')
    const onResize = () => { if (media.matches) closeMenu() }
    document.addEventListener('keydown', onKey); document.addEventListener('pointerdown', onPointer); media.addEventListener('change', onResize)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer); media.removeEventListener('change', onResize) }
  }, [menuOpen, closeMenu])
  const fullscreen = page === 'chess' || page === 'city' || page === 'glass'
  const sceneNavigation = page === 'glass' ? 'glass-navigation' : ''
  return <>
    <aside className={`fixed top-0 left-0 z-30 hidden h-dvh w-[200px] flex-col site-navigation px-12 pt-16 md:flex lg:w-[240px] lg:px-16 ${sceneNavigation} ${fullscreen ? 'pointer-events-none' : 'bg-site'}`}>
      <div className="pointer-events-auto"><NavLinks /></div><div className="pointer-events-auto mt-8"><SocialLinks /></div>
    </aside>
    <header className={`fixed inset-x-0 top-0 z-40 site-navigation flex h-[88px] items-center justify-between gap-3 border-b px-8 md:hidden ${sceneNavigation} ${fullscreen ? 'pointer-events-none border-transparent' : 'border-neutral-400/30 bg-site/95 backdrop-blur-md'}`}>
      <a href="/" onClick={event=>{event.preventDefault();navigate('chess')}} className="pointer-events-auto font-mono text-[12px] tracking-[-0.035em] sm:text-[13px]">Neilson Koerner-Safrata</a>
      <div ref={menuRef} className="pointer-events-auto">
        <button ref={toggleRef} type="button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={toggleMenu} className="flex h-11 w-11 cursor-pointer items-center justify-center border-0">
          {menuOpen ? <XIcon size={26} /> : <ListIcon size={28} />}
        </button>
        {menuOpen && <div id="mobile-navigation" className="absolute top-[80px] right-8 w-56 border border-neutral-500/60 bg-site px-4 py-4 shadow-none"><NavLinks /><div className="mt-4 border-t border-neutral-400/40 pt-5"><SocialLinks /></div></div>}
      </div>
    </header>
  </>
}
function Project({ project, index }: { project: typeof content.projects[number], index: number }) {
  return <article className="flex min-w-0 flex-col">
    <div className="site-image-frame">
      <img src={project.image} alt={project.title} loading={index < 2 ? 'eager' : 'lazy'} decoding="async" className={`block aspect-4/3 w-full ${project.imageFit === 'contain' ? 'object-contain' : 'object-cover'} ${project.image.toLowerCase().endsWith('.gif') ? 'opacity-80' : 'opacity-90'}`} />
    </div>
    <div className="flex flex-1 flex-col pt-5">
      <h2 className="text-[28px] leading-[1.1] font-extrabold tracking-[-0.04em]">{project.title}</h2>
      <p className="mt-1 font-mono text-[14px] leading-snug text-ink/70">{project.metadata}</p>
      <div className="project-description mt-4 font-mono text-[15px] leading-[1.4]" dangerouslySetInnerHTML={{ __html: project.description }} />
      {project.links.length > 0 && <div className="project-links mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 pt-9 text-sm font-normal">
        {project.links.map((link,i)=><a key={i} href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center">{link.label}</a>)}
      </div>}
      {project.details && <details hidden className="mt-5 text-sm"><summary className="inline-flex cursor-pointer items-center gap-1.5 text-ink/70 hover:text-ink">Details<CaretDownIcon size={14} /></summary><div className="project-details mt-3 leading-relaxed" dangerouslySetInnerHTML={{ __html: project.details }} /></details>}
      {project.video && <details hidden className="mt-4"><summary className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-ink/70"><PlayIcon size={14} />Watch video</summary><iframe loading="lazy" title={`${project.title} video`} src={project.video} className="mt-3 aspect-video w-full border-0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></details>}
    </div>
  </article>
}
function Work() {
  return <div className="cv-projects">
    <h1 className="sr-only">CV — Neilson Koerner-Safrata</h1>
    {content.projects.filter(project => !project.hidden).map((project,index)=><Project key={project.title} project={project} index={index} />)}
  </div>
}
function About() {
  return <article className="max-w-[660px]">
    <h1 className="sr-only">About Neilson Koerner-Safrata</h1>
    <div className="site-image-frame mb-10 w-full md:max-w-[380px]">
      <img src="/images/Neilson%20Koerner-Safrata%20Wide.png" alt="Neilson Koerner-Safrata" className="block h-auto w-full opacity-90" />
    </div>
    <div className="about-copy space-y-5 px-3 text-[15px] leading-[1.45] md:max-w-[380px] md:px-0" dangerouslySetInnerHTML={{ __html: content.about }} />
  </article>
}
function App() {
  const { page, chessVisited, syncLocation, navigate } = useNavigation()
  useEffect(()=>{window.addEventListener('popstate',syncLocation);window.addEventListener('hashchange',syncLocation);return()=>{window.removeEventListener('popstate',syncLocation);window.removeEventListener('hashchange',syncLocation)}},[syncLocation])
  useLayoutEffect(()=>{ document.documentElement.dataset.theme = page === 'glass' ? 'glass' : page === 'books' ? 'reading' : 'site'; document.title = 'Neilson'; updatePageMetadata(page) },[page])
  return <>
    {page !== 'glass' && <a href="#main" className="skip-link">Skip to content</a>}{page !== 'books' && page !== 'glass' && <Navigation />}
    <main id="main" tabIndex={-1} className={page === 'chess' || page === 'city' || page === 'glass' ? "fixed top-0 left-0 z-0 h-dvh w-screen" : page === 'books' ? "min-h-dvh" : "main-page min-h-dvh px-8 pt-32 pb-28 md:ml-[200px] md:px-12 md:pt-20 lg:ml-[240px] lg:px-16 lg:pt-24 xl:px-20"}>
      {/* Viewport width stays constant when a content page's scrollbar disappears. */}
      {chessVisited && <div className="fixed top-0 left-0 z-0 h-dvh w-screen" style={{ visibility: page === 'chess' ? 'visible' : 'hidden' }} aria-hidden={page !== 'chess'} inert={page !== 'chess'}>
        <Suspense fallback={null}><Chess active={page === 'chess'} /></Suspense>
      </div>}
      {page === 'chess' ? null : page === 'city' ? <Suspense fallback={null}><City /></Suspense> : page === 'glass' ? <Suspense fallback={null}><Glass /></Suspense> : page === 'books' ? <Books /> : <div key={page} className="page-enter">
        {page === 'work' ? <Work /> : page === 'about' ? <About /> : <div className="py-12"><h1 className="text-3xl font-bold">Page not found</h1><a href="/work/" className="mt-6 inline-block underline" onClick={e=>{e.preventDefault();navigate('work')}}>Return to CV</a></div>}
      </div>}
    </main>
  </>
}

const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!)
if (import.meta.hot) import.meta.hot.data.root = root
root.render(<React.StrictMode><App /></React.StrictMode>)
