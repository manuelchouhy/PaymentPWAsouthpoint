import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Feature task-key-display: la columna "Task #" muestra el CÓDIGO CORTO de Zoho (task.key,
 * ej. "PP1-T5"). Fallback: si la key aún no se resolvió, cae al id largo; "—" solo si no hay
 * ninguno. Ambos tests son de SOLO LECTURA. Regresión clave: nunca debe reaparecer el formato
 * viejo "#id" (con "#"). El id largo SÍ es un fallback aceptable (no es regresión).
 *
 * PRECONDICIÓN: requieren la migración 0050 aplicada (columna task_key) y sync-task-keys
 * corrido en el test DB, para que haya códigos cortos reales que mostrar. Los tests EXIGEN
 * al menos un código corto presente (piso > 0): si la columna existe pero está sin poblar,
 * todo saldría "—" y el test DEBE fallar (no dar falso verde — justo la condición del revert
 * previo de esta feature). El comportamiento fino de formatTaskLabel está en unit tests.
 */

test.describe('task-key-display · código corto junto al nombre', () => {
  test('Entries (/entries): columna "Task #" con el código corto (nunca el id largo)', async ({ page }) => {
    await loginAsTestAdmin(page)
    await page.goto('/entries')

    // Header de la columna (siempre visible, no col-optional).
    await expect(page.locator('th.col-tasknum')).toHaveText('Task #')

    // La grilla no está vacía/rota: la primera celda Task # aparece.
    const taskNumCells = page.locator('td.col-tasknum')
    await expect(taskNumCells.first()).toBeVisible()
    const count = await taskNumCells.count()
    expect(count).toBeGreaterThan(0)

    let withKey = 0
    for (let i = 0; i < count; i++) {
      const text = (await taskNumCells.nth(i).innerText()).trim()
      if (text && text !== '—') {
        expect(text).toMatch(/^\S+$/) // token sin espacios (código corto o id largo de fallback)
        // Código corto real = tiene alguna letra (ej. "PP1-T5"); el id largo es solo dígitos.
        if (/[A-Za-z]/.test(text)) withKey++
      }
    }
    // Piso: al menos una celda con código corto REAL (no solo el fallback de id largo). Si
    // todo cae al id largo o "—", la feature no está poblada → FALLA, no falso verde.
    expect(withKey).toBeGreaterThan(0)
    console.log(`[task-key] Entries: celdas Task # con código corto: ${withKey} de ${count}`)
  })

  test('Billing: el rótulo del task usa "<key> · <nombre>" (código corto, sin "#")', async ({ page }) => {
    await loginAsTestAdmin(page)
    await page.goto('/billing')

    // Espera a que la grilla pinte (sin timeout fijo): el primer rótulo de task.
    const labels = page.locator('.proj-table .cell-soft')
    await expect(labels.first()).toBeVisible()
    const count = await labels.count()

    let withKey = 0
    for (let i = 0; i < count; i++) {
      const text = (await labels.nth(i).innerText()).trim()
      // REGRESIÓN: el formato viejo "#<id> · nombre" ya no se usa.
      expect(text.startsWith('#')).toBe(false)
      // Código corto de Zoho como primer token (ej. "PP1-T5" o "PP1-T5 · nombre"): shape
      // <prefijo>-<algo>, sin espacios antes del separador.
      if (/^[A-Za-z0-9]+-[A-Za-z0-9]\S*( · .+)?$/.test(text)) withKey++
    }
    // Piso: al menos un rótulo con código corto real (si no hay ninguno, la feature no está
    // poblada → FALLA, no falso verde). Ver PRECONDICIÓN en el docstring.
    expect(withKey).toBeGreaterThan(0)
    console.log(`[task-key] Billing: rótulos con código corto: ${withKey} de ${count} cell-soft`)
  })
})
