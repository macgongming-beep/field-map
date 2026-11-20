import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const { webkit, chromium } = await import('/Users/gm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
const base = 'https://chinese-territory-app-demo.vercel.app'
const dir = process.env.LOCAL_ARTIFACT ? resolve(process.env.LOCAL_ARTIFACT, '.vercel/output/static') : null
const label = process.env.LABEL ?? 'group-map-landplot'
const results = []
for (const engine of ['webkit', 'chromium']) {
  const browser = await ({ webkit, chromium }[engine]).launch()
  try {
    const context = await browser.newContext({ viewport: { width: engine === 'webkit' ? 390 : 1440, height: 844 }, serviceWorkers: 'block', isMobile: engine === 'webkit', hasTouch: engine === 'webkit' })
    await context.route('**/*.supabase.co/**', route => {
      const req = route.request(), url = new URL(req.url())
      assert.equal(url.hostname, 'itjlykpjmlcvanqpmkmc.supabase.co')
      assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(req.method()) || (url.pathname.includes('/rpc/') && !/save|manage|assign|remove|delete|update|create|reset/.test(url.pathname)), 'Business writes forbidden')
      return route.continue()
    })
    if (dir) await context.route(`${base}/**`, route => {
      const path = new URL(route.request().url()).pathname
      if (path.startsWith('/_vercel/')) return route.fulfill({ status: 204 })
      const file = resolve(dir, `.${path}`)
      assert.ok(file === dir || file.startsWith(`${dir}/`))
      return route.fulfill({ path: path !== '/' && existsSync(file) ? file : `${dir}/index.html` })
    })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base)
    await page.locator('#login-id').fill('관리자')
    await page.locator('#pin').fill('0000')
    await page.locator('.login-form button[type=submit]').click()
    await page.locator(engine === 'webkit' ? '.bottom-nav' : '.desktop-sidebar-nav').waitFor({ timeout: 45000 })
    await page.goto(`${base}/map`)
    const button = page.getByRole('button', { name: '집단 구역만 보기', exact: true })
    await button.waitFor({ timeout: 45000 })
    assert.equal(await button.locator('path').first().getAttribute('d'), 'm12 8 6-3-6-3v10')
    const sizes = engine === 'webkit' ? [[390, 'normal'], [320, 'normal'], [390, 'x-large']] : [[1440, 'normal']]
    for (const [width, scale] of sizes) {
      await page.setViewportSize({ width, height: 844 })
      await page.evaluate(value => document.documentElement.dataset.fontScale = value, scale)
      const header = page.locator(engine === 'webkit' ? '.mobile-map-header' : '.group-map-controls')
      const before = await header.boundingBox()
      await button.click()
      if (engine === 'chromium') {
        // Toggling may move the desktop control out from under the pointer.
        await button.evaluate(element => element.blur())
        await button.focus()
      }
      const hint = page.getByRole('tooltip', { name: '집단 구역만 보기' })
      await hint.waitFor()
      const tip = await hint.boundingBox(), control = await button.boundingBox()
      assert.ok(tip.y >= control.y + control.height, 'Hint remains below the control')
      assert.ok(tip.x >= 0 && tip.x + tip.width <= width, 'Hint stays inside viewport')
      assert.equal((await header.boundingBox()).height, before.height, 'Hint does not resize header')
      await page.screenshot({ path: `scratch/${label}-${engine}-${width}-${scale}.png` })
      await hint.waitFor({ state: 'hidden', timeout: 3000 })
      results.push({ engine, width, scale, headerHeight: before.height, hintBelow: true, hintDisappeared: true })
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
}
writeFileSync(`scratch/${label}.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results))
