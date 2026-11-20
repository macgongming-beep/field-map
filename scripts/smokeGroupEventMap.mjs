import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
const { webkit, chromium } = await import('/Users/gm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
const base = 'https://chinese-territory-app-demo.vercel.app'
const seed = JSON.parse(readFileSync('scratch/group-territory-demo-seed.json', 'utf8'))
const label = process.env.LABEL ?? 'event-group-map-local'
const dir = process.env.LOCAL_ARTIFACT ? resolve(process.env.LOCAL_ARTIFACT, '.vercel/output/static') : null
const results = []
for (const engine of ['webkit', 'chromium']) {
  const browser = await ({ webkit, chromium }[engine]).launch()
  const context = await browser.newContext({ viewport: { width: engine === 'webkit' ? 390 : 1440, height: 844 }, serviceWorkers: 'block', isMobile: engine === 'webkit', hasTouch: engine === 'webkit' })
  const page = await context.newPage(), errors = [], reads = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => { if (r.url().includes('/rest/v1/')) reads.push(new URL(r.url()).pathname) })
  await context.route('**/*.supabase.co/**', route => {
    const r = route.request(), url = new URL(r.url())
    assert.equal(url.hostname, 'itjlykpjmlcvanqpmkmc.supabase.co')
    assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(r.method()) || (url.pathname.includes('/rpc/') && !/save|manage|assign|remove|delete|update|create|reset/.test(url.pathname)), 'Business writes forbidden')
    return route.continue()
  })
  if (dir) await context.route(`${base}/**`, route => {
    const path = new URL(route.request().url()).pathname
    if (path.startsWith('/_vercel/')) return route.fulfill({ status: 204 })
    const file = resolve(dir, `.${path}`); assert.ok(file === dir || file.startsWith(`${dir}/`))
    return route.fulfill({ path: path !== '/' && existsSync(file) ? file : `${dir}/index.html` })
  })
  try {
    console.log(`${engine}: login`)
    await page.goto(base); await page.locator('#login-id').fill('관리자'); await page.locator('#pin').fill('0000'); await page.locator('.login-form button[type=submit]').click()
    await page.locator(engine === 'webkit' ? '.bottom-nav' : '.desktop-sidebar-nav').waitFor({ timeout: 45000 })
    await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 45000 })
    if (engine === 'webkit') {
      await page.goto(`${base}/map?groupCode=${seed.groups[0].code}`)
      await page.getByRole('combobox', { name: '집단 구역 보기' }).waitFor({ timeout: 45000 })
      await page.waitForTimeout(2000)
      for (const [width, scale] of [[390, 'normal'], [320, 'normal'], [430, 'normal'], [390, 'x-large']]) {
        await page.setViewportSize({ width, height: 844 })
        await page.evaluate(scale => document.documentElement.dataset.fontScale = scale, scale)
        await page.waitForTimeout(200)
        const measure = () => page.evaluate(() => {
          const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, height: r.height } }
          return { header: rect('.mobile-map-header'), title: rect('.mobile-map-title-copy > :first-child'), stats: rect('.mm-stats-sub'), actions: rect('.mobile-map-header-actions'), legend: rect('.mobile-map-legend-card'), width: innerWidth, scroll: document.documentElement.scrollWidth }
        })
        const on = await measure()
        await page.locator('.group-map-selector select').evaluate(el => {
          const option = el.selectedOptions[0]; option.dataset.old = option.textContent
          option.textContent = '아주 긴 집단 이름이 표시되어도 높이는 그대로 유지'
        })
        const longName = await measure()
        assert.equal(longName.header.height, on.header.height)
        assert.ok(longName.title.right <= longName.actions.x + 1)
        await page.locator('.group-map-selector select').evaluate(el => { el.selectedOptions[0].textContent = el.selectedOptions[0].dataset.old })
        await page.screenshot({ path: `scratch/${label}-${width}-${scale}.png` })
        await page.getByRole('button', { name: '집단 구역만 보기', exact: true }).click(); await page.waitForTimeout(200)
        const off = await measure()
        assert.equal(on.header.height, off.header.height, 'Group toggle must not change header height')
        assert.ok(on.title.right <= on.actions.x + 1)
        assert.ok(on.scroll <= width + 1 && off.scroll <= width + 1)
        assert.ok(on.legend.y >= on.header.bottom - 1)
        results.push({ engine, width, scale, on, off })
        await page.getByRole('button', { name: '집단 구역만 보기', exact: true }).click(); await page.waitForTimeout(200)
      }
      await page.evaluate(() => document.documentElement.dataset.fontScale = 'normal')
      await page.setViewportSize({ width: 390, height: 844 })
      await page.locator('.mm-back-btn').click()
    }
    await page.locator(engine === 'webkit' ? '.bottom-nav' : '.desktop-sidebar-nav').getByRole('button', { name: '배정', exact: true }).click()
    const section = page.locator('.group-territory-assignment')
    console.log(`${engine}: ownership`)
    await section.waitFor({ timeout: 45000 })
    await section.locator('select').selectOption(seed.groups[0].code)
    await page.waitForTimeout(1000)
    const start = reads.length
    await section.getByRole('button', { name: '지도', exact: true }).click()
    await page.waitForFunction(() => window.naver?.maps)
    await page.waitForTimeout(2000)
    const polygons = await section.locator('.naver-map-canvas svg path[style*="fill:#638773"]').count()
    assert.ok(polygons > 0, 'Real map boundaries must render')
    const paths = section.locator('.naver-map-canvas svg path[style*="fill:#638773"]')
    await paths.first().click({ force: true, position: { x: 60, y: 40 } })
    await page.waitForTimeout(200)
    const selected = await section.locator('.group-territory-actions').innerText()
    assert.match(selected, /1개 선택/, 'Polygon click selects a territory')
    await page.screenshot({ path: `scratch/${label}-${engine}-ownership-map.png` })
    await section.getByRole('button', { name: '목록', exact: true }).click()
    assert.equal(await section.locator('.group-territory-list input:checked').count(), 1)
    await section.getByRole('button', { name: '지도', exact: true }).click()
    await page.waitForTimeout(800)
    const extraReads = reads.slice(start)
    assert.deepEqual(extraReads, [], 'Map/list switches reuse already-loaded boundaries')
    results.push({ engine, polygons, selected, extraReads })
    console.log(`${engine}: event`)
    await page.goto(`${base}/calendar?openEvent=198`)
    await page.locator('.gs-assignment-open').waitFor({ timeout: 45000 })
    await page.locator('.gs-assignment-open').click()
    await page.locator('.asg-editor-titles strong').filter({ hasText: '东滩' }).waitFor({ timeout: 45000 })
    assert.match(await page.locator('.asg-editor-titles strong').innerText(), /东滩/)
    if (await page.locator('.asg-team-open').count() === 0) {
      await page.locator('.asg-person-chip').first().click()
      await page.locator('.asg-build-group-btn').click()
    }
    await page.locator('.asg-team-open').first().click()
    await page.waitForTimeout(1800)
    assert.equal(await page.locator('.asg-editor-titles strong').innerText(), '东滩 · 구역 배분')
    const headerBefore = await page.locator('.asg-zone .asg-editor-head').boundingBox()
    const members = page.locator('.asg-zone .asg-editor-titles span'), originalMembers = await members.innerText()
    await members.evaluate(el => el.textContent = '이름이 아주 긴 신청자 · '.repeat(15))
    assert.equal((await page.locator('.asg-zone .asg-editor-head').boundingBox()).height, headerBefore.height)
    await members.evaluate((el, text) => el.textContent = text, originalMembers)
    await page.screenshot({ path: `scratch/${label}-${engine}-event-map.png` })
    await page.getByRole('button', { name: '목록', exact: true }).click()
    await page.screenshot({ path: `scratch/${label}-${engine}-event-list.png` })
    const list = await page.locator('.asg-zone').innerText()
    assert.ok(!list.includes(seed.cards[2].name), 'Other group card excluded')
    results.push({ engine, eventHeading: '东滩 · 구역 배분', eventList: list })
    assert.deepEqual(errors, [])
  } catch (e) {
    await page.screenshot({ path: `scratch/${label}-${engine}-failure.png` })
    console.error(JSON.stringify({ error: e.message, errors, body: (await page.locator('body').innerText()).slice(0, 3500) }))
    throw e
  } finally { await browser.close() }
}
writeFileSync(`scratch/${label}.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results))
