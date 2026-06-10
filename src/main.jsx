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
import { AuthGate } from './components/AuthGate.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthGate>
        {({ user, signOut }) => (
          <Routes>
            <Route element={<Layout user={user} onSignOut={signOut} />}>
              <Route index element={<App />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="contract-alerts" element={<ContractAlertSettingsPage />} />
              <Route path="collections" element={<CollectionsPage />} />
              <Route path="collection-alerts" element={<CollectionAlertSettingsPage />} />
              <Route path="payments" element={<PaymentsPage />} />
              <Route path="payment-alerts" element={<PaymentAlertSettingsPage />} />
              <Route path="supplier-contracts" element={<SupplierContractsPage />} />
              <Route path="supplier-alerts" element={<SupplierAlertSettingsPage />} />
            </Route>
          </Routes>
        )}
      </AuthGate>
    </BrowserRouter>
  </StrictMode>,
)
