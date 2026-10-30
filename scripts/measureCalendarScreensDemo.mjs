import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { pathToFileURL } from 'node:url'

if (!process.env.DEMO_ENV_FILE || !process.env.PLAYWRIGHT_MODULE || !process.argv.includes('--confirm-demo')) throw Error('Explicit demo environment required')
const config = parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8'))
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const root = 'https://chinese-territory-app-demo.vercel.app'
const db = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
const browser = await chromium.launch({ headless: true })
try {
  for (const role of process.env.MEASUREMENT_ROLES?.split(',') ?? ['VOLUNTEER', 'LEADER', 'ADMIN']) {
    const id = config[`TEST_${role}_ID`], pin = config[`TEST_${role}_PIN`]
    if (!id || !pin) throw Error(`Missing ${role} demo credentials`)
    const context = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, deviceScaleFactor: 1, serviceWorkers: 'block' })
    const page = await context.newPage()
    const requests = [], errors = []
    let phase = 'login'
    await context.route('**/*.supabase.co/**', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== db) throw Error('Non-demo database blocked')
      const endpoint = url.pathname.split('/').pop()
      if (endpoint === 'auto_close_stale_sessions') return route.fulfill({ status: 200, body: 'null', contentType: 'application/json' })
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && ![
        'auth_login', 'verify_session', 'get_card_summaries', 'get_recipient_return_visit_card_ids',
        'territory_sync_clock', 'get_my_profile', 'get_session_users', 'get_my_permissions',
        'get_my_notifications', 'get_my_chat_reads', 'get_chat_message_meta',
      ].includes(endpoint)) {
        errors.push(`blocked write ${endpoint}`)
        return route.abort()
      }
      if (request.method() !== 'OPTIONS') requests.push({ phase, endpoint, method: request.method(), select: url.searchParams.get('select') })
      return route.continue()
    })
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      window.__navLoading = []
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node instanceof Element && (node.matches('.app-loading') || node.querySelector('.app-loading'))) {
            window.__navLoading.push({ path: location.pathname, at: performance.now() })
          }
        }
      }).observe(document, { childList: true, subtree: true })
    })
    try {
      await page.goto(root)
      await page.locator('#login-id').fill(id)
      await page.locator('#pin').fill(pin)
      await page.locator('.login-form button[type="submit"]').click()
      await page.locator('.bottom-nav').waitFor({ timeout: 60000 })
      await page.waitForTimeout(2500)
      const entry = await page.locator('script[type="module"]').first().getAttribute('src')
      const paths = role === 'VOLUNTEER' ? ['/calendar', '/territory', '/'] : ['/calendar', '/territory', '/zone', '/']
      const results = []
      for (let trip = 1; trip <= 3; trip++) for (const path of paths) {
        phase = `${trip}:${path}`
        const start = requests.length
        const loadingStart = await page.evaluate(() => window.__navLoading.length)
        await page.evaluate(path => { history.pushState(null, '', path); dispatchEvent(new PopStateEvent('popstate')) }, path)
        await page.waitForFunction(() => !document.querySelector('.app-loading') && !!document.querySelector('.bottom-nav'), undefined, { timeout: 60000 })
        await page.waitForTimeout(1200)
        const rows = requests.slice(start)
        results.push({ trip, path, requests: rows.length, calendar: rows.filter(r => ['calendar_events', 'event_card_assignments', 'event_card_assignment_cards'].includes(r.endpoint)).length,
          endpoints: Object.fromEntries([...new Set(rows.map(r => r.endpoint))].map(endpoint => [endpoint, rows.filter(r => r.endpoint === endpoint).length])),
          loadingMounts: await page.evaluate(start => window.__navLoading.length - start, loadingStart) })
      }
      if (process.argv.includes('--months')) {
        await page.evaluate(() => { history.pushState(null, '', '/calendar'); dispatchEvent(new PopStateEvent('popstate')) })
        await page.waitForTimeout(1500)
        for (let month = 1; month <= 2; month++) {
          phase = `uncached-month-${month}`
          const start = requests.length
          // The month title sits between the previous/next buttons.
          await page.locator('h3').filter({ hasText: /2026|2027/ }).locator('..').locator('button').first().click()
          await page.waitForFunction(() => !document.querySelector('.app-loading') && !!document.querySelector('.bottom-nav'), undefined, { timeout: 60000 })
          await page.waitForTimeout(3000)
          const rows = requests.slice(start)
          results.push({ phase, requests: rows.length, reads: rows })
        }
      }
      await page.screenshot({ path: `/tmp/demo-navigation-${role.toLowerCase()}-${process.env.MEASUREMENT_LABEL ?? 'run'}.png` })
      console.log(JSON.stringify({ role, entry, results, initialNotices: requests.filter(r => r.phase === 'login' && r.endpoint === 'notices').length, errors }))
      if (errors.length) throw Error('Browser errors or unexpected writes detected')
    } catch (error) {
      console.error(JSON.stringify({ role, phase, error: error.message, errors, page: (await page.locator('body').innerText()).slice(0, 1200) }))
      throw error
    } finally { await context.close() }
  }
} finally { await browser.close() }
