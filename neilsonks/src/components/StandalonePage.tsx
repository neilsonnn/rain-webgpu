import type { MouseEvent, ReactNode } from 'react'
import { useNavigation } from '../store'
import './standalone.css'

// Shared presentation for Books and future long-form pages.
export function StandalonePage({ children, className = '' }: { children: ReactNode; className?: string }) {
  const navigate = useNavigation(state => state.navigate)
  function returnHome(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault()
      navigate('chess')
    }
  }
  return <div className={`standalone-page ${className}`}>
    <header className="standalone-header"><a href="/" onClick={returnHome}>← www.neilsonks.com</a></header>
    {children}
  </div>
}
