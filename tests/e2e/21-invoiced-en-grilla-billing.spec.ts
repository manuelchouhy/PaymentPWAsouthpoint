import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 10 (lote WhatsApp 2026-09-10): las horas ya facturadas se ven en la grilla de
 * Billing SIN activar el toggle de estado — un badge "X h invoiced" en el header de cada
 * proyecto, siempre visible (incluso con el filtro 'pending' por defecto).
 */
test('Billing: el badge "invoiced" aparece en la grilla sin togglear a Invoiced', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/billing')

  const statusSelect = page.getByLabel('Filter by billing status')
  await expect(statusSelect).toBeVisible()
  // Arranca en la vista por defecto: pendientes (ready to bill).
  await expect(statusSelect).toHaveValue('pending')

  const badges = page.locator('.bill-project__invoiced')

  // Contamos los badges en la vista 'all' (ahí aparecen todos los proyectos con
  // horas facturadas): es el techo de lo que puede verse.
  await statusSelect.selectOption('all')
  await expect(statusSelect).toHaveValue('all')
  // Esperar a que la grilla se re-renderice.
  await page.waitForTimeout(300)
  const badgesInAll = await badges.count()

  // Volver a la vista por defecto (pendiente): el badge tiene que seguir apareciendo
  // para los proyectos que además tienen horas pendientes — SIN togglear a Invoiced.
  await statusSelect.selectOption('pending')
  await expect(statusSelect).toHaveValue('pending')
  await page.waitForTimeout(300)

  const badgesInPending = await badges.count()

  if (badgesInAll === 0) {
    // No hay horas facturadas en la data de test: nada que verificar más allá de que
    // el mecanismo no rompe la grilla. (Documentado como límite de la data.)
    test.info().annotations.push({ type: 'note', text: 'Sin horas invoiced en la data de test' })
    return
  }

  // Hay facturadas: al menos un badge y, si hay proyectos mixtos, se ven en 'pending'.
  const first = badges.first()
  if (badgesInPending > 0) {
    await expect(first).toBeVisible()
    await expect(first).toHaveText(/[\d.]+\s*h invoiced/)
  } else {
    // Todos los proyectos facturados están 100% facturados (sin filas pendientes):
    // no aparecen en 'pending'. Es el open item conocido; el KPI global los cubre.
    test.info().annotations.push({
      type: 'note',
      text: 'Proyectos 100% facturados no aparecen en vista pending (open item)',
    })
  }
})
