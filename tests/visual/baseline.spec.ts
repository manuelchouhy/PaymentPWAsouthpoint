import { test } from '@playwright/test'
import { captureAllScreens } from './capture'

test('baseline visual snapshots before UI redesign', async ({ page }) => {
  test.setTimeout(180_000)
  await captureAllScreens(page, 'tests/visual/baseline')
})
