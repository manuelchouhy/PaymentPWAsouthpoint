import { useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import { NAV_ITEMS, ADMIN_NAV_ITEMS } from './Sidebar'

const ALL_ITEMS = [...NAV_ITEMS, ...ADMIN_NAV_ITEMS]

function useBreadcrumb() {
  const { pathname } = useLocation()
  const match = ALL_ITEMS.find((item) =>
    item.end ? pathname === item.to : pathname.startsWith(item.to),
  )
  return match?.label ?? 'Dashboard'
}

export function Header({ rolesBadge, onToggleSidebar }) {
  const breadcrumb = useBreadcrumb()

  return (
    <header className="app-header">
      <button
        type="button"
        className="app-header__menu-btn"
        onClick={onToggleSidebar}
        aria-label="Toggle navigation"
      >
        <Menu size={18} aria-hidden="true" />
      </button>
      <span className="app-header__breadcrumb">{breadcrumb}</span>
      <div className="app-header__right">
        {rolesBadge !== 'No role' && (
          <span className="masthead__badge">{rolesBadge}</span>
        )}
        <ThemeToggle />
      </div>
    </header>
  )
}
