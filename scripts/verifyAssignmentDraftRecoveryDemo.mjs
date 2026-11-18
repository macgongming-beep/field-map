// Demo-only UI edits stay in this disposable browser's local draft. Never share.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const config = parseEnv(readFileSync(process.env.TEST_ENV_FILE ?? '.env.test.local', 'utf8'))
assert.equal(config.VITE_SUPABASE_URL, 'https://itjlykpjmlcvanqpmkmc.supabase.co')
const base = process.env.PREVIEW_URL ?? 'https://chinese-territory-app-demo.vercel.app'
assert.ok(['127.0.0.1', 'chinese-territory-app-demo.vercel.app'].includes(new URL(base).hostname))
const label = process.argv[2]
assert.match(label ?? '', /^[a-zA-Z0-9_-]+$/)
const fixture = JSON.parse(readFileSync('scratch/group-tabs-fixture.json', 'utf8'))
const browser = await (process.env.ENGINE === 'webkit' ? webkit : chromium).launch()
const results = []
try {
  for (const role of (process.env.ROLES ?? 'leader,admin').split(',')) {
    const actor = role === 'admin' ? { name: '관리자' } : fixture.actors.find(a => a.role === role)
    assert.ok(actor && ['leader', 'admin'].includes(role))
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
    const page = await context.newPage(), errors = [], requests = [], checks = []
    let failBuildings = false, advanceRevision = false, injectedRevisions = 0
    await page.addInitScript(() => {
      const Native = window.WebSocket, sockets = []
      window.WebSocket = class extends Native { constructor(...args) { super(...args); sockets.push(this) } }
      window.__closeTestSockets = () => {
        const live = sockets.filter(socket => socket.readyState === Native.OPEN)
        live.forEach(socket => socket.close())
        return live.length
      }
    })
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/rest/v1/')) requests.push(req.url()) })
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url())
      if (url.hostname.endsWith('.supabase.co')) {
        assert.equal(url.origin, config.VITE_SUPABASE_URL)
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
          const rpc = url.pathname.replace('/rest/v1/rpc/', '')
          assert.ok(req.method() === 'POST' && url.pathname.startsWith('/rest/v1/rpc/')
            && /^(auth_|verify_session$|auto_close_stale_sessions$|get_|read_|territory_)/.test(rpc), `Business write forbidden: ${url.pathname}`)
        }
        if (failBuildings && url.pathname === '/rest/v1/buildings') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Injected demo read failure' }) })
        if (advanceRevision && url.pathname === '/rest/v1/calendar_events' && req.method() === 'GET') {
          const response = await route.fetch(), body = await response.json()
          for (const event of Array.isArray(body) ? body : [body]) if (event?.assignment_revision != null) {
            event.assignment_revision = String(BigInt(event.assignment_revision) + 1n)
            injectedRevisions++
          }
          return route.fulfill({ response, json: body })
        }
        return route.continue()
      }
      if (url.origin === new URL(base).origin || url.hostname.endsWith('.naver.com') || url.hostname.endsWith('.pstatic.net')) return route.continue()
      return route.abort()
    })
    const settle = async () => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(650) }
    const pull = async () => {
      const head = page.locator('.asg-editor-head').first()
      const touch = (type, y) => head.evaluate((el, { type, y }) => {
        const event = new Event(type, { bubbles: true })
        Object.defineProperty(event, 'touches', { value: y == null ? [] : [{ clientY: y }] })
        el.dispatchEvent(event)
      }, { type, y })
      await touch('touchstart', 50)
      await touch('touchmove', 230)
      await page.getByText('놓으면 새로고침', { exact: true }).waitFor()
      await touch('touchend', null)
      await page.locator('.pull-refresh-spinner').waitFor()
      await page.locator('.pull-refresh-spinner').waitFor({ state: 'detached', timeout: 45000 })
      await settle()
    }
    try {
      await page.goto(base)
      await page.locator('#login-id').fill(actor.name)
      await page.locator('#pin').fill('0000')
      const login = page.waitForResponse(r => new URL(r.url()).pathname === '/rest/v1/rpc/auth_login')
      await page.locator('.login-form button[type=submit]').click()
      const identity = (await (await login).json())[0]
      assert.equal(identity?.role, role)
      assert.ok(identity.name)
      await page.locator('.gs-event-block>button').first().click()
      await page.locator('.gs-assignment-open').click()
      await page.locator('.asg-editor-footer').waitFor({ timeout: 45000 })
      await settle()
      const eventId = new URL(page.url()).searchParams.get('openEvent')
      assert.match(eventId ?? '', /^\d+$/)
      const key = `mobileLeaderAssignmentDraft:${eventId}:${identity.name}`
      const stored = () => page.evaluate(k => JSON.parse(localStorage.getItem(k) ?? 'null'), key)
      await page.locator('.asg-person-chip').first().click()
      await page.locator('.asg-build-group-btn').click()
      await page.waitForFunction(k => JSON.parse(localStorage.getItem(k) ?? 'null')?.updatedAt, key)
      const draft = await stored()
      assert.ok(draft.teams.some(team => team.members.length))
      await page.locator('.asg-team-open').last().click()
      await page.locator('.asg-zone').waitFor()
      const zone = await page.locator('.asg-zone').elementHandle()
      const sameDraftAndScreen = async () => {
        assert.deepEqual(await stored(), draft)
        assert.equal(await zone.evaluate(el => el.isConnected), true, 'Refresh must not unmount the editing screen')
      }
      let start = requests.length
      await pull()
      await sameDraftAndScreen()
      assert.ok(requests.slice(start).some(url => new URL(url).pathname === '/rest/v1/buildings'))
      checks.push({ name: 'manual refresh retains identical draft and mounted zone screen', requests: requests.length - start })

      await page.waitForTimeout(5100)
      failBuildings = true
      start = requests.length
      await pull()
      await sameDraftAndScreen()
      assert.ok(requests.slice(start).some(url => new URL(url).pathname === '/rest/v1/buildings'))
      await page.getByText('자료를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.', { exact: true }).waitFor()
      checks.push({ name: 'failed manual refresh retains identical draft and screen', errors: [...errors] })
      failBuildings = false

      // Force a real WebSocket reconnect, then a foreground recovery after its cooldown.
      const socket = page.waitForEvent('websocket', { timeout: 30000 })
      await context.setOffline(true)
      assert.ok(await page.evaluate(() => window.__closeTestSockets()) > 0)
      await page.waitForTimeout(1200)
      await context.setOffline(false)
      await socket
      start = requests.length
      await page.clock.setFixedTime(new Date(Date.now() + 125000))
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await settle()
      await sameDraftAndScreen()
      assert.ok(requests.length > start, 'Foreground recovery must actually read data')
      checks.push({ name: 'offline/reconnected socket and foreground recovery preserve draft and screen', requests: requests.length - start })

      await page.reload()
      await page.locator('.gs-assignment-open').waitFor({ timeout: 60000 })
      await page.locator('.gs-assignment-open').click()
      await page.locator('.asg-editor-footer').waitFor({ timeout: 45000 })
      await settle()
      assert.deepEqual(await stored(), draft)
      assert.equal(await page.locator('.asg-team-open').count(), draft.teams.length)
      checks.push('browser reload and reopen restore the same local draft')

      // Only the read response changes. No other user's assignment is written.
      advanceRevision = true
      await page.reload()
      await page.locator('.gs-assignment-open').waitFor({ timeout: 60000 })
      await page.locator('.gs-assignment-open').click()
      await page.locator('.asg-conflict').waitFor({ timeout: 45000 })
      await settle()
      assert.ok(injectedRevisions > 0)
      assert.deepEqual(await stored(), draft, 'Do not overwrite a draft before conflict choice')
      await page.reload()
      await page.locator('.gs-assignment-open').waitFor({ timeout: 60000 })
      await page.locator('.gs-assignment-open').click()
      await page.locator('.asg-conflict').waitFor({ timeout: 45000 })
      await page.getByRole('button', { name: '내 임시 저장 이어서', exact: true }).click()
      await page.locator('.asg-editor-footer').waitFor()
      await settle()
      const restored = await stored()
      assert.deepEqual(restored.teams, draft.teams)
      assert.equal(restored.baseRevision, String(BigInt(draft.baseRevision) + 1n))
      checks.push('simulated newer server revision requires choice; reload before choosing retains local draft')
      await page.screenshot({ path: `scratch/draft-recovery-${label}-${role}.png`, fullPage: true })
      assert.deepEqual(errors, [], 'No uncaught errors, including failed refresh')
      results.push({ role, checks, errors, passed: true })
      console.log(JSON.stringify({ role, passed: true, checks }))
    } catch (error) {
      results.push({ role, checks, errors, passed: false, failure: error.message })
      throw error
    } finally { await context.close() }
  }
} finally {
  await browser.close()
  writeFileSync(`scratch/draft-recovery-${label}.json`, JSON.stringify({ base, engine: process.env.ENGINE ?? 'chromium', results }, null, 2))
}
