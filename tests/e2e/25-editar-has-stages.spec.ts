import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 03 (stage-budget-hours): en EDICIÓN, el wizard "Edit SOW & Scope" se
 * reemplazó por el editor "Edit Budget Hours". Ya NO se pueden agregar/eliminar
 * stages ni tasks ni togglear "Has stages?"; lo único editable es el budget por
 * stage y cuál stage está activo. Las tasks se muestran read-only. La creación de
 * proyectos conserva el wizard completo (no se prueba acá).
 *
 * "Proyecto Prueba" tiene el stage "hola". Se prueba sin guardar (no muta la DB).
 */
test('Editar: botón "Edit Budget Hours", sin agregar/eliminar stages ni tasks, budget por stage editable', async ({
  page,
}) => {
  await loginAsTestAdmin(page)
  await page.goto('/projects')

  const row = page.locator('table.proj-table tbody tr', { hasText: 'Proyecto Prueba' }).first()
  await row.waitFor({ state: 'visible', timeout: 30000 })
  await row.click()

  const carousel = page.locator('.modal--carousel')
  await expect(carousel).toBeVisible()
  // El botón viejo ya no existe; el nuevo sí.
  await expect(carousel.getByRole('button', { name: /Edit SOW/i })).toHaveCount(0)
  await carousel.getByRole('button', { name: /Edit Budget Hours/i }).click()

  await expect(page.getByRole('heading', { name: 'Edit Budget Hours' })).toBeVisible()

  // Nada de agregar/eliminar ni togglear stages/tasks.
  await expect(page.getByRole('button', { name: 'Add stage' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add task' })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: 'Has stages?' })).toHaveCount(0)

  // Budget del stage "hola" editable + radio para marcarlo activo.
  await expect(page.getByLabel(/Budget hours for hola/i)).toBeVisible()
  await expect(page.getByLabel(/Mark hola as the active stage/i)).toBeVisible()

  // Cerrar SIN guardar (no muta la DB).
  await page.keyboard.press('Escape')
})
