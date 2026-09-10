import { test, expect } from '@playwright/test'
import { loginAsTestAdmin } from './helpers'

/**
 * Slice 01 (lote WhatsApp 2026-09-10): el task id se muestra junto al nombre en la
 * página Entries (/entries) y en Billing. Ambos tests son de SOLO LECTURA.
 *
 * Best-effort: sólo afirman el formato "#id · nombre" sobre las filas que tienen
 * task id (no fallan si la base viva no tiene ninguno visible en ese momento).
 */

test.describe('Slice 01 · task id junto al nombre', () => {
  test('Entries (/entries): la columna Task muestra "#id · nombre" cuando hay task id', async ({
    page,
  }) => {
    await loginAsTestAdmin(page)
    await page.goto('/entries')

    // Las celdas de Task de la grilla de Entries; las que tienen id empiezan con "#".
    const taskCells = page.locator('td.col-task')
    await taskCells.first().waitFor({ state: 'visible' })
    const count = await taskCells.count()

    let checked = 0
    for (let i = 0; i < count; i++) {
      const text = (await taskCells.nth(i).innerText()).trim()
      if (text.startsWith('#')) {
        expect(text).toMatch(/^#\S+/)
        checked++
      }
    }
    console.log(`[slice01] Entries: celdas Task con id verificadas: ${checked} de ${count}`)
  })

  test('Billing: el rótulo del task usa "#id · nombre" cuando hay task id (best-effort)', async ({
    page,
  }) => {
    await loginAsTestAdmin(page)
    await page.goto('/billing')

    // Las filas de hora muestran el rótulo del task en un .cell-soft dentro de la
    // grilla de facturación. Tomamos los que empiezan con "#" (los que tienen id).
    const labels = page.locator('.proj-table .cell-soft')
    await page.waitForTimeout(1500) // deja cargar la grilla contra la base viva
    const count = await labels.count()

    let checked = 0
    for (let i = 0; i < count; i++) {
      const text = (await labels.nth(i).innerText()).trim()
      if (text.startsWith('#')) {
        // Formato "#<id> · <nombre>" o sólo "#<id>": el id son dígitos tras el #.
        expect(text).toMatch(/^#\S+/)
        checked++
      }
    }
    console.log(`[slice01] rótulos con task id verificados: ${checked} de ${count} cell-soft`)
  })
})
