import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Feature "budget editable desde Edit" (slice editable-base-budget).
 *
 * Verifica el camino end-to-end del nuevo campo "Budget Hours" del ProjectFormModal
 * (botón Edit): editar el base_budget_hours de un proyecto y verlo reflejado en la
 * grilla de Projects and SOW y como Budget en Client Summary.
 *
 * DATA-SAFE: no crea ni borra proyectos (projects no tiene política de borrado, ver
 * 0004_projects.sql). Lee el budget ORIGINAL del proyecto elegido y lo RESTAURA al
 * final, así la corrida no deja residuo en la base de test-mode.
 *
 * Requiere el entorno de test-mode (npm run dev con VITE_TEST_MODE + Supabase de
 * test), como el resto de tests/e2e. El proyecto elegido es el primero de la grilla
 * con "Show all statuses" activo (incluye los sincronizados de Zoho de cualquier
 * estado, que es el caso que este feature vino a destrabar: su Edit no tiene gate
 * por client_id).
 */

const TEST_BUDGET = '137.5' // valor distintivo; formatHours(137.5) === '137.5'

test('editar el base budget desde "Edit" se refleja en la grilla y en Client Summary', async ({
  page,
}) => {
  await loginAsTestAdmin(page)

  // (1) Projects and SOW, mostrando todos los estados (incluye proyectos de Zoho).
  await page.goto('/projects')
  const showAll = page.getByLabel('Show all statuses')
  if (!(await showAll.isChecked())) await showAll.check()

  const firstRow = page.locator('tbody tr').first()
  await expect(firstRow).toBeVisible()
  const projectName = (await firstRow.locator('.cell-strong').innerText()).trim()
  // Celda de budget de la fila (col-num cell-mono). Se guarda el texto original para
  // restaurarlo al final: '—' si el proyecto no tenía budget.
  const budgetCell = firstRow.locator('td.col-num.cell-mono').first()
  const originalBudgetText = (await budgetCell.innerText()).trim()

  // (2) Abrir el detalle y el modal "Edit" (exacto, para no tomar "Edit SOW & Scope").
  await firstRow.click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()

  // (3) El campo Budget Hours existe (sin gate por client_id) y es editable.
  const budgetInput = page.locator('#pf-baseBudgetHours')
  await expect(budgetInput).toBeVisible()
  await budgetInput.fill(TEST_BUDGET)
  await page.getByRole('button', { name: 'Save changes' }).click()

  // (4) La grilla refleja el nuevo budget.
  await expect(budgetCell).toHaveText('137.5')

  // (5) Client Summary muestra el mismo Budget para ese proyecto.
  await page.goto('/client-summary')
  const csProjectRow = page.locator('tbody tr').filter({ hasText: projectName }).first()
  await expect(csProjectRow).toBeVisible()
  await expect(csProjectRow).toContainText('137.5')

  // (6) Restaurar el budget original (data-safe). Si era '—' se vacía el campo.
  await page.goto('/projects')
  if (!(await showAll.isChecked())) await showAll.check()
  const rowAgain = page.locator('tbody tr').filter({ hasText: projectName }).first()
  await rowAgain.click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const restoreValue = originalBudgetText === '—' ? '' : originalBudgetText
  await budgetInput.fill(restoreValue)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.locator('#pf-baseBudgetHours')).toHaveCount(0)
})
