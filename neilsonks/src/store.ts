import { create } from 'zustand'
export type Page = 'chess' | 'city' | 'glass' | 'work' | 'about' | 'books' | 'not-found'
export function pageFromLocation(): Page {
  const path = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/+$/, '') || '/'
  if (path === '/' || path === '/index.html') return window.location.hash === '#about' ? 'about' : 'chess'
  if (path === '/chess' || path === '/chess/index.html') return 'chess'
  if (path === '/city') return 'city'
  if (path === '/glass') return 'glass'
  if (path === '/work' || path === '/work/index.html') return 'work'
  if (path === '/about' || path === '/info') return 'about'
  if (path === '/reading' || path === '/reading/index.html' || path === '/books') return 'books'
  return 'not-found'
}
const paths = { chess: '/', city: '/city/', glass: '/glass/', work: '/work/', about: '/about/', books: '/reading/' }
interface NavigationState {
  page: Page
  chessVisited: boolean
  menuOpen: boolean
  navigate: (page: Exclude<Page, 'not-found'>) => void
  toggleMenu: () => void
  closeMenu: () => void
  syncLocation: () => void
}
const initialPage = pageFromLocation()
export const useNavigation = create<NavigationState>((set) => ({
  page: initialPage, chessVisited: initialPage === 'chess', menuOpen: false,
  navigate: (page) => { window.history.pushState({}, '', paths[page]); set(state => ({ page, chessVisited: state.chessVisited || page === 'chess', menuOpen: false })); window.scrollTo(0, 0) },
  toggleMenu: () => set((state) => ({ menuOpen: !state.menuOpen })),
  closeMenu: () => set({ menuOpen: false }),
  syncLocation: () => { const page = pageFromLocation(); set(state => ({ page, chessVisited: state.chessVisited || page === 'chess', menuOpen: false })) },
}))
