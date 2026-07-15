import { test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { loginAsTestAdmin } from '../e2e/helpers'

/**
 * Auditoría de accesibilidad (WCAG AA) sobre las 3 pantallas más usadas.
 * Solo reporta — no arregla nada automáticamente (Fase 5 del prompt de
 * rediseño). Los resultados van a stdout como JSON, uno por pantalla.
 */
const SCREENS = ['/', '/time-entries', '/payments']

test('accessibility audit (WCAG AA) on the 3 most-used screens', async ({ page }) => {
  test.setTimeout(60_000)
  await loginAsTestAdmin(page)

  for (const path of SCREENS) {
    await page.goto(path)
    await page.waitForTimeout(500)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()

    console.log(`\n=== ${path} — ${results.violations.length} violation type(s) ===`)
    for (const v of results.violations) {
      console.log(`[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
      console.log(`  ${v.helpUrl}`)
      for (const node of v.nodes.slice(0, 8)) {
        console.log(`  - ${node.target.join(' ')} :: ${node.failureSummary?.split('\n').join(' ')}`)
      }
    }
  }
})
