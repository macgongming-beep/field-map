import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
const { webkit, chromium } = await import('/Users/gm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
const base = 'https://chinese-territory-app-demo.vercel.app'
const fixture = process.env.BROWSE_FIXTURE === 'true'
const before = process.env.BEFORE === 'true'
const label = process.env.LABEL ?? 'compact-group-browse'
assert.match(label, /^[a-z0-9-]+$/)
const dir = fixture ? resolve('scratch/browse-ui') : process.env.LOCAL_ARTIFACT ? resolve(process.env.LOCAL_ARTIFACT, '.vercel/output/static') : null
const results = []
for (const engine of ['webkit', 'chromium']) {
  const browser = await ({ webkit, chromium }[engine]).launch()
  const context = await browser.newContext({ viewport: { width: engine === 'webkit' ? 390 : 1440, height: 844 }, serviceWorkers: 'block', isMobile: engine === 'webkit', hasTouch: engine === 'webkit' })
  const page = await context.newPage(), errors = [], reads = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => { if (r.url().includes('/rest/v1/')) reads.push(new URL(r.url()).pathname) })
  await context.route('**/*.supabase.co/**', route => {
    assert.ok(!fixture, 'Synthetic screen must not read DB')
    const r = route.request(), url = new URL(r.url())
    assert.equal(url.hostname, 'itjlykpjmlcvanqpmkmc.supabase.co')
    assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(r.method()) || (url.pathname.includes('/rpc/') && !/save|manage|assign|remove|delete|update|create|reset/.test(url.pathname)), 'Business writes forbidden')
    return route.continue()
  })
  if (dir) await context.route(`${base}/**`, route => {
    let path = new URL(route.request().url()).pathname
    if (path.startsWith('/_vercel/')) return route.fulfill({ status: 204 })
    if (fixture) path = path.replace(/^\/scratch\/browse-ui/, '')
    const file = resolve(dir, `.${path}`); assert.ok(file === dir || file.startsWith(`${dir}/`))
    return route.fulfill({ path: path !== '/' && existsSync(file) ? file : `${dir}/index.html` })
  })
  try {
    if (fixture) await page.goto(`${base}/scratch/browse-ui/scripts/fixtures/groupTerritoryBrowse.html`)
    else {
      await page.goto(base); await page.locator('#login-id').fill('관리자'); await page.locator('#pin').fill('0000'); await page.locator('.login-form button[type=submit]').click()
      const nav = page.locator(engine === 'webkit' ? '.bottom-nav' : '.desktop-sidebar-nav')
      await nav.waitFor({ timeout: 45000 }); await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 45000 })
      await nav.getByRole('button', { name: '배정', exact: true }).click()
    }
    const section = page.locator('.group-territory-assignment')
    await section.waitFor({ timeout: 45000 })
    if (!before) assert.equal(await section.locator('h1').count(), engine === 'webkit' ? 0 : 1)
    if (fixture) {
      await section.getByRole('tab', { name: '전체 구역 609' }).click()
      assert.equal(await section.locator('li').count(), 50)
      await section.getByRole('button', { name: '더 보기' }).click()
      assert.equal(await section.locator('li').count(), 100)
    }
    await page.waitForTimeout(1000)
    const start = reads.length, began = performance.now()
    await section.getByRole('button', { name: '지도', exact: true }).click()
    if (!before) {
      assert.equal(await section.getByRole('searchbox').count(), 0)
      assert.equal(await section.getByLabel('전체 선택', { exact: true }).count(), 0)
    }
    const polygons = section.locator('.naver-map-canvas svg path[style*="fill:"]')
    if (fixture) {
      await page.waitForFunction(() => document.querySelectorAll('.naver-map-canvas svg path[style*="fill:"]').length === 609, { timeout: 30000 })
      const allReadyMs = Math.round(performance.now() - began)
      await section.getByRole('combobox', { name: '지역 선택' }).selectOption('기흥구')
      await page.waitForFunction(() => document.querySelectorAll('.naver-map-canvas svg path[style*="fill:"]').length === 203)
      await section.getByRole('combobox', { name: '동 선택' }).selectOption('첫동')
      await page.waitForFunction(() => document.querySelectorAll('.naver-map-canvas svg path[style*="fill:"]').length === 102)
      results.push({ engine, synthetic: true, all: 609, district: 203, neighborhood: 102, allReadyMs })
    } else await polygons.first().waitFor({ timeout: 30000 })
    await page.waitForTimeout(1000)
    for (const [width, scale] of engine === 'webkit' ? [[390, 'normal'], [320, 'normal'], [390, 'x-large']] : [[1440, 'normal']]) {
      await page.setViewportSize({ width, height: 844 }); await page.evaluate(s => document.documentElement.dataset.fontScale = s, scale); await page.waitForTimeout(200)
      const metrics = await page.evaluate(() => {
        const map = document.querySelector('.group-territory-map').getBoundingClientRect()
        const nav = document.querySelector('.group-territory-navigation')?.getBoundingClientRect()
        return { mapTop: map.top, mapHeight: map.height, width: innerWidth, scroll: document.documentElement.scrollWidth, navHeight: nav?.height }
      })
      assert.ok(metrics.scroll <= width + 1, 'No horizontal overflow')
      await page.screenshot({ path: `scratch/${label}-${engine}-${width}-${scale}.png` })
      results.push({ engine, width, scale, ...metrics })
    }
    await section.getByRole('button', { name: '목록', exact: true }).click()
    if (fixture) {
      assert.equal(await section.locator('li').count(), 50)
      assert.equal(await section.locator('.group-territory-result-count').innerText(), '50 / 102개')
      assert.ok((await section.locator('li').allTextContents()).every(text => text.includes('기흥구 첫동')))
    }
    await page.waitForTimeout(650)
    assert.deepEqual(reads.slice(start), [])
    assert.deepEqual(errors, [])
    results.push({ engine, additionalDbRequests: reads.slice(start).length, errors })
  } catch (error) {
    await page.screenshot({ path: `scratch/${label}-${engine}-failure.png` })
    console.error(JSON.stringify({ error: error.message, errors, body: (await page.locator('body').innerText()).slice(0, 2000) }))
    throw error
  } finally { await browser.close() }
}
writeFileSync(`scratch/${label}.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results))
