import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 01 (lote WhatsApp 2026-09-10): el task id se muestra junto al nombre.
 * Ambos tests son de SOLO LECTURA (no escriben en la base). La base de test tiene
 * datos reales (entries con task id), así que exigen al menos un id presente en vez
 * de pasar en vacío — un grid vacío o roto debe fallar, no dar falso verde.
 *
 *  - Entries (/entries): columna "Task #" propia (siempre visible) con el id crudo.
 *  - Billing: rótulo del task en la fila de una hora con el formato "#id · nombre".
 */

test.describe('Slice 01 · task id junto al nombre', () => {
  test('Entries (/entries): columna "Task #" propia con el id del task', async ({ page }) => {
    await loginAsTestAdmin(page)
    await page.goto('/entries')

    // Header de la columna nueva (siempre visible, no col-optional).
    await expect(page.locator('th.col-tasknum')).toHaveText('Task #')

    // La grilla tiene filas en la base de test → la primera celda Task # aparece.
    const taskNumCells = page.locator('td.col-tasknum')
    await taskNumCells.first().waitFor({ state: 'visible' })
    const count = await taskNumCells.count()

    let withId = 0
    for (let i = 0; i < count; i++) {
      const text = (await taskNumCells.nth(i).innerText()).trim()
      if (text && text !== '—') {
        expect(text).toMatch(/^\S+$/) // un id sin espacios
        withId++
      }
    }
    expect(withId).toBeGreaterThan(0)
    console.log(`[slice01] Entries: celdas Task # con id: ${withId} de ${count}`)
  })

  test('Billing: el rótulo del task usa "#id · nombre" cuando hay task id', async ({ page }) => {
    await loginAsTestAdmin(page)
    await page.goto('/billing')

    // Espera a que la grilla pinte (sin timeout fijo): el primer rótulo de task.
    const labels = page.locator('.proj-table .cell-soft')
    await labels.first().waitFor({ state: 'visible' })
    const count = await labels.count()

    let checked = 0
    for (let i = 0; i < count; i++) {
      const text = (await labels.nth(i).innerText()).trim()
      if (text.startsWith('#')) {
        // "#<id> · <nombre>" o sólo "#<id>": id sin espacios ni '·', y si hay
        // separador, un nombre no vacío después.
        expect(text).toMatch(/^#[^\s·]+( · .+)?$/)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
    console.log(`[slice01] Billing: rótulos con task id: ${checked} de ${count} cell-soft`)
  })
})
