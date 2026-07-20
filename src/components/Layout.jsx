import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { rolesLabel } from '../lib/permissions'
import { Sidebar } from './Sidebar'
import { Header } from './Header'

export function Layout({ user, profile, can, onSignOut }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const rolesBadge = rolesLabel(profile?.roles ?? [])

  return (
    <div className="app">
      <Sidebar
        can={can}
        open={sidebarOpen}
        onNavigate={() => setSidebarOpen(false)}
        user={user}
        profile={profile}
        onSignOut={onSignOut}
      />
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="app__main">
        <Header
          rolesBadge={rolesBadge}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          user={user}
          profile={profile}
          onSignOut={onSignOut}
        />

        <div className="app__inner">
          <Outlet context={{ user, profile, can, onSignOut }} />
        </div>

        <footer className="app-footer">
          <span>Southpoint Tech Labs © 2026 · v1.0.0</span>
        </footer>
      </div>
    </div>
  )
}
