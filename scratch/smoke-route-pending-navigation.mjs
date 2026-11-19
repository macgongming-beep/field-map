import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
const { webkit } = await import('/Users/gm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
const base = 'http://127.0.0.1:4182'
const demo = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
const output = 'scratch/sections-matched-nov20/pending-navigation-smoke.json'
const browser = await webkit.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' })
const page = await context.newPage()
const failures = [], snapshots = []
let hold = false, release = [], heldCount = 0, abortedReads = 0
page.on('pageerror', error => failures.push({ type: 'pageerror', message: error.message }))
page.on('response', response => {
  if (response.url().startsWith(demo) && response.status() >= 400) failures.push({ type: 'http', status: response.status() })
})
page.on('requestfailed', request => { if (request.url().startsWith(demo)) abortedReads++ })
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  if (url.hostname.endsWith('.supabase.co')) {
    assert.equal(url.origin, demo, 'Production traffic is forbidden')
    assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || url.pathname.startsWith('/rest/v1/rpc/'), 'No table writes')
    if (hold && url.pathname.startsWith('/rest/v1/')) {
      heldCount++
      await new Promise(resolve => release.push(resolve))
    }
    await route.continue().catch(() => {})
  } else if (url.origin === base) await route.continue()
  else await route.abort()
})
await context.routeWebSocket('**/*', socket => {
  assert.equal(new URL(socket.url()).hostname, new URL(demo).hostname)
  socket.connectToServer()
})
const nav = page.locator('.bottom-nav')
const loading = page.getByRole('status').filter({ hasText: /불러오/ })
const mapToggle = page.getByRole('button', { name: '지도', exact: true })
const regionRows = page.getByRole('button').filter({ hasText: /주택\s*\d+[\s\S]*상가\s*\d+/ })
async function readyHome() {
  await page.waitForFunction(() => location.pathname === '/' && !document.querySelector('.app-loading')
    && ![...document.querySelectorAll('[role="status"],[role="alert"]')].some(el => el.getClientRects().length && /불러오|다시 시도/.test(el.textContent))
    && [...document.querySelectorAll('.bottom-nav')].some(el => el.getClientRects().length)
    && /오늘의 봉사/.test(document.body.innerText), undefined, { timeout: 15000 })
}
async function snapshot(step) {
  const state = { step, path: new URL(page.url()).pathname, navVisible: await nav.isVisible(), loadingVisible: await loading.isVisible(), zoneControlVisible: await mapToggle.isVisible(), regionRows: await regionRows.count() }
  snapshots.push(state)
  await page.screenshot({ path: `scratch/sections-matched-nov20/pending-${step}.png` })
  return state
}
try {
  await page.goto(base)
  await page.locator('#login-id').fill('관리자')
  await page.locator('#pin').fill('0000')
  await page.locator('.login-form button[type="submit"]').click()
  await readyHome()
  await page.waitForTimeout(800)
  hold = true
  await nav.getByRole('button', { name: '구역', exact: true }).click()
  await loading.waitFor({ state: 'visible', timeout: 10000 })
  await page.waitForTimeout(100)
  const pending = await snapshot('zone-pending')
  assert.ok(heldCount > 0)
  assert.ok(pending.navVisible)
  assert.equal(pending.zoneControlVisible, false, 'Partial zone controls must stay behind the gate')
  assert.equal(pending.regionRows, 0)
  await nav.getByRole('button', { name: '홈', exact: true }).click()
  await readyHome()
  const home = await snapshot('home-during-pending')
  assert.equal(home.loadingVisible, false)
  assert.equal(home.zoneControlVisible, false)
  await nav.getByRole('button', { name: '구역', exact: true }).click()
  await loading.waitFor({ state: 'visible', timeout: 10000 })
  assert.ok(await nav.isVisible())
  hold = false
  for (const resolve of release) resolve()
  release = []
  await mapToggle.waitFor({ state: 'visible', timeout: 30000 })
  await regionRows.first().waitFor({ state: 'visible', timeout: 30000 })
  await page.waitForTimeout(600)
  const final = await snapshot('zone-recovered')
  assert.equal(final.loadingVisible, false)
  assert.ok(final.regionRows > 0)
  assert.equal(/\b(?:NaN|undefined|null)\b/.test(await page.locator('body').innerText()), false)
  assert.deepEqual(failures, [])
} catch (error) {
  failures.push({ type: 'assertion', message: error.message })
  await page.screenshot({ path: 'scratch/sections-matched-nov20/pending-failure.png' })
  process.exitCode = 1
} finally {
  hold = false
  for (const resolve of release) resolve()
  const report = { base, demoBackendOnly: true, tableWritesAllowed: false, heldCount, abortedReads, snapshots, failures }
  writeFileSync(output, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}
