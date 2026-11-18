// Read-only service-list/map checks. Demo session housekeeping is allowed, service writes are not.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const config = parseEnv(readFileSync(process.env.TEST_ENV_FILE ?? '.env.test.local', 'utf8'))
assert.equal(config.VITE_SUPABASE_URL, 'https://itjlykpjmlcvanqpmkmc.supabase.co')
const fixture = JSON.parse(readFileSync('scratch/group-tabs-fixture.json', 'utf8'))
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5191'
assert.ok(['127.0.0.1', 'chinese-territory-app-demo.vercel.app'].includes(new URL(base).hostname))
const label = process.argv[2]
assert.match(label ?? '', /^[a-zA-Z0-9_-]+$/)
const browser = await (process.env.ENGINE === 'webkit' ? webkit : chromium).launch()
const results = []
try {
  for (const width of [390, 1365]) for (const role of ['user', 'leader', 'admin']) {
    const actor = role === 'admin' ? { name: '관리자' } : fixture.actors.find(a => a.role === role)
    assert.ok(actor)
    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' })
    const page = await context.newPage(), errors = [], reads = [], navigations = []
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) navigations.push(new URL(frame.url()).pathname + new URL(frame.url()).search)
    })
    const checks = []
    await context.route('**/*', route => {
      const req = route.request(), url = new URL(req.url())
      if (url.hostname.endsWith('.supabase.co')) {
        assert.equal(url.origin, config.VITE_SUPABASE_URL)
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
          const rpc = url.pathname.replace('/rest/v1/rpc/', '')
          assert.ok(req.method() === 'POST' && url.pathname.startsWith('/rest/v1/rpc/')
            && /^(auth_|verify_session$|auto_close_stale_sessions$|get_|read_|territory_)/.test(rpc), `Unexpected write: ${req.method()} ${url.pathname}`)
        }
        return route.continue()
      }
      if (url.origin === new URL(base).origin || url.hostname.endsWith('.naver.com') || url.hostname.endsWith('.pstatic.net')) return route.continue()
      return route.abort()
    })
    page.on('pageerror', error => errors.push(error.message))
    page.on('response', response => {
      if (new URL(response.url()).pathname.startsWith('/rest/v1/')) reads.push({ path: new URL(response.url()).pathname, status: response.status() })
    })
    const settle = async () => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(650) }
    try {
      await page.goto(base)
      await page.locator('#login-id').fill(actor.name)
      await page.locator('#pin').fill('0000')
      const login = page.waitForResponse(r => new URL(r.url()).pathname === '/rest/v1/rpc/auth_login')
      await page.locator('.login-form button[type=submit]').click()
      const identity = await (await login).json()
      assert.equal(identity[0]?.role, role, 'Verify actual role, not a developer view switch')
      await page.locator('#login-id').waitFor({ state: 'detached', timeout: 60000 })
      const nav = page.locator(width < 980 ? '.bottom-nav' : '.desktop-sidebar-nav')
      await nav.waitFor()
      await settle()
      if (role === 'admin') {
        assert.equal(await nav.getByRole('button', { name: /나의\s*봉사/ }).count(), 0)
        await nav.getByRole('button', { name: '구역', exact: true }).click()
        await page.waitForURL('**/zone*')
        await settle()
        assert.ok((await page.locator('body').innerText()).includes('구역'))
        assert.equal(await page.locator('.mobile-today-service-section,.desktop-my-service-page').count(), 0)
        checks.push('actual admin retains territory management, no personal-service substitution')
      } else {
        const service = () => nav.getByRole('button', { name: /나의\s*봉사/ }).click()
        const content = page.locator(width < 980 ? '.mobile-today-service-section' : '.desktop-my-service-page')
        await service()
        await content.waitFor({ timeout: 45000 })
        await settle()
        const toggles = page.locator(width < 980 ? '.mobile-today-service-card:not(.open) .mobile-today-service-toggle' : '.dms-today-card:not(.open) .dms-today-toggle')
        if (await toggles.count()) await toggles.first().click()
        const displayed = await content.innerText()
        assert.ok(displayed.length > 10)
        checks.push({ name: 'personal service content', displayed })
        if (width < 980) {
          const past = page.locator('.mt-past-toggle')
          if (await past.count()) {
            await past.click()
            await page.locator('.mobile-past-mini').waitFor()
            await page.getByRole('button', { name: '이전 달', exact: true }).click()
            checks.push('past assignment calendar opens')
          } else checks.push('no past assignments in this demo actor; covered by SQL/read tests')
          await page.locator('.mt-restaurant-section button').filter({ hasText: '식당봉사' }).click()
          await page.locator('.restaurant-service-sheet').waitFor()
          await settle()
          await page.locator('.restaurant-sheet-close').click()
          checks.push('restaurant browser opens and closes without starting a session')
        }
        await page.screenshot({ path: `scratch/myservice-${label}-${role}-${width}.png`, fullPage: true })
        const map = page.locator('.assigned-service-map-button').first()
        if (await map.count()) {
          const from = reads.length
          const navigationStart = navigations.length
          await map.click()
          await page.waitForURL('**/map?assignmentMap=*')
          await settle()
          await page.waitForFunction(() => !document.querySelector('.app-loading'))
          if (process.env.EXPECT_REUSE === 'true') {
            assert.equal(reads.slice(from).filter(r => r.path.endsWith('/event_restaurant_assignments') || r.path.endsWith('/calendar_events')).length, 0, 'Assigned-map navigation should retain its complete service context')
          }
          checks.push('assignment map retains its complete event context')
          await page.goBack()
          await content.waitFor()
          await settle()
          const routeChanges = navigations.slice(navigationStart)
          assert.ok(routeChanges.length >= 2)
          assert.ok(routeChanges.every(path => path.startsWith('/map?assignmentMap=') || path === '/territory'), 'Map round trip must not pass through home or calendar')
          checks.push({ name: 'direct map round trip', routes: routeChanges, requests: reads.length - from })
          checks.push('return to personal service')
        } else checks.push('no assigned map link for this actor')
        await nav.getByRole('button', { name: '홈', exact: true }).click()
        await service()
        await content.waitFor()
        await settle()
        checks.push('home round trip retains service screen')
      }
      assert.deepEqual(errors, [])
      assert.ok(reads.every(r => r.status < 400))
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: `scratch/myservice-${label}-${role}-${width}-final.png`, fullPage: true })
      results.push({ role, width, checks, errors })
      console.log(JSON.stringify({ role, width, passed: true }))
    } catch (error) {
      await page.screenshot({ path: `scratch/myservice-${label}-${role}-${width}-failure.png`, fullPage: true })
      throw error
    } finally { await context.close() }
  }
} finally {
  await browser.close()
  writeFileSync(`scratch/myservice-${label}-ui.json`, JSON.stringify({ base, engine: process.env.ENGINE ?? 'chromium', results }, null, 2))
}
