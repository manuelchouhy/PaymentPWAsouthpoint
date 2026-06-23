import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import App from './App.jsx'
import { Layout } from './components/Layout.jsx'
import { ProjectsPage } from './pages/ProjectsPage.jsx'
import { ContractAlertSettingsPage } from './pages/ContractAlertSettingsPage.jsx'
import { CollectionsPage } from './pages/CollectionsPage.jsx'
import { CollectionAlertSettingsPage } from './pages/CollectionAlertSettingsPage.jsx'
import { PaymentsPage } from './pages/PaymentsPage.jsx'
import { PaymentAlertSettingsPage } from './pages/PaymentAlertSettingsPage.jsx'
import { SupplierContractsPage } from './pages/SupplierContractsPage.jsx'
import { SupplierAlertSettingsPage } from './pages/SupplierAlertSettingsPage.jsx'
import { AuditLogPage } from './pages/AuditLogPage.jsx'
import { TraceabilityPage } from './pages/TraceabilityPage.jsx'
import { EmailOutboxPage } from './pages/EmailOutboxPage.jsx'
import { DashboardPage } from './pages/DashboardPage.jsx'
import { AuthGate } from './components/AuthGate.jsx'
import { can as checkCan } from './lib/permissions.js'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthGate>
        {({ user, profile, appConfig, signOut }) => {
          const enforcement = appConfig?.permissionsEnforced ?? false
          const roles = profile?.roles ?? []
          const can = (action) => checkCan(action, roles, enforcement)
          return (
            <Routes>
              <Route
                element={
                  <Layout
                    user={user}
                    profile={profile}
                    can={can}
                    onSignOut={signOut}
                  />
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="time-entries" element={<App />} />
                <Route path="projects" element={<ProjectsPage />} />
                <Route path="contract-alerts" element={<ContractAlertSettingsPage />} />
                <Route path="collections" element={<CollectionsPage />} />
                <Route path="collection-alerts" element={<CollectionAlertSettingsPage />} />
                <Route path="payments" element={<PaymentsPage />} />
                <Route path="payment-alerts" element={<PaymentAlertSettingsPage />} />
                <Route path="supplier-contracts" element={<SupplierContractsPage />} />
                <Route path="supplier-alerts" element={<SupplierAlertSettingsPage />} />
                <Route path="audit-log" element={<AuditLogPage />} />
                <Route path="traceability" element={<TraceabilityPage />} />
                <Route path="email-outbox" element={<EmailOutboxPage />} />
              </Route>
            </Routes>
          )
        }}
      </AuthGate>
    </BrowserRouter>
  </StrictMode>,
)
