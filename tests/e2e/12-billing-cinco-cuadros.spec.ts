import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 09 (lote WhatsApp 2026-09-10): los 4 cuadros de Billing se reemplazan por 5:
 * Pending to bill · Selected + consumed / budget · Invoiced · Unallocated · Overage.
 * Read-only.
 */
test('Billing: 5 cuadros nuevos; se van "No client" y "Clients to bill"', async ({ page }) => {
  await loginAsTestAdmin(page)
  await page.goto('/billing')

  const kpis = page.locator('.dash-kpis')
  await expect(kpis).toBeVisible()

  for (const label of [
    'Pending to bill',
    'Selected + consumed / budget',
    'Invoiced',
    'Unallocated',
    'Overage',
  ]) {
    await expect(kpis.getByText(label, { exact: true })).toBeVisible()
  }

  // Los dos cuadros viejos ya no existen.
  await expect(kpis.getByText('No client', { exact: true })).toHaveCount(0)
  await expect(kpis.getByText('Clients to bill', { exact: true })).toHaveCount(0)

  // Debe haber exactamente 5 cuadros.
  await expect(kpis.locator('.dash-kpi')).toHaveCount(5)

  // Cuadro #2 sin filtro ni selección → "—".
  const card2 = page.locator('.dash-kpi', { hasText: 'Selected + consumed / budget' })
  await expect(card2.locator('.dash-kpi__value')).toHaveText('—')
})
