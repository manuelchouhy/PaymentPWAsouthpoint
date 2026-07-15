import { test } from '@playwright/test'
import { captureAllScreens } from './capture'

test('after visual snapshots — Southpoint redesign', async ({ page }) => {
  test.setTimeout(180_000)
  await captureAllScreens(page, 'tests/visual/after')
})
