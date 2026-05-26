import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { AuthGate } from './components/AuthGate.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthGate>
      {({ user, signOut }) => <App user={user} onSignOut={signOut} />}
    </AuthGate>
  </StrictMode>,
)
