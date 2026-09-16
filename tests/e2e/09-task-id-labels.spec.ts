import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Feature task-key-display: la columna "Task #" muestra el CÓDIGO CORTO de Zoho (task.key,
 * ej. "PP1-T5"), NO el id interno largo. Cuando la key aún no se resolvió se muestra "—".
 * Ambos tests son de SOLO LECTURA. Regresión clave: nunca debe reaparecer el id largo
 * (numérico) ni el formato viejo "#id".
 *
 * Caveat: son smoke tests contra la base de test viva; el wiring y el "—" de fallback
 * requieren la migración 0050 aplicada (columna task_key) y sync-task-keys corrido para
 * ver keys reales. El comportamiento fino de formatTaskLabel está cubierto por unit tests
 * (format.test.js); esto sólo confirma el cableado end-to-end y que NO se muestra el id largo.
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
        expect(text).toMatch(/^\S+$/) // token sin espacios (código corto)
        expect(text).not.toMatch(/^\d{8,}$/) // REGRESIÓN: no el id largo numérico de Zoho
        withKey++
      }
    }
    console.log(`[task-key] Entries: celdas Task # con código corto: ${withKey} de ${count}`)
  })

  test('Billing: el rótulo del task usa "<key> · <nombre>" (código corto, sin "#")', async ({ page }) => {
    await loginAsTestAdmin(page)
    await page.goto('/billing')

    // Espera a que la grilla pinte (sin timeout fijo): el primer rótulo de task.
    const labels = page.locator('.proj-table .cell-soft')
    await expect(labels.first()).toBeVisible()
    const count = await labels.count()

    let withSep = 0
    for (let i = 0; i < count; i++) {
      const text = (await labels.nth(i).innerText()).trim()
      // REGRESIÓN: el formato viejo "#<id> · nombre" ya no se usa.
      expect(text.startsWith('#')).toBe(false)
      if (text.includes(' · ')) withSep++
    }
    console.log(`[task-key] Billing: rótulos "<key> · <nombre>": ${withSep} de ${count} cell-soft`)
  })
})
