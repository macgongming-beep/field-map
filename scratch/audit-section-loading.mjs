import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { advanceReadyTiming } from './section-ready-timing.mjs'
const { chromium, webkit } = await import('/Users/gm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
const env = parseEnv(readFileSync('../chinese-territory-app/.env.test.local', 'utf8'))
const fixture = JSON.parse(readFileSync('scratch/group-tabs-fixture.json', 'utf8'))
const demoSupabase = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
const baseUrl = new URL(process.env.PREVIEW_URL ?? 'https://chinese-territory-app-demo.vercel.app')
assert.ok(baseUrl.origin === 'https://chinese-territory-app-demo.vercel.app'
  || (baseUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname)), 'Only demo or localhost previews are allowed')
assert.equal(baseUrl.pathname, '/')
assert.equal(baseUrl.search, '')
assert.equal(baseUrl.hash, '')
const base = baseUrl.origin
assert.equal(env.VITE_SUPABASE_URL, demoSupabase)
const delay = Number(process.env.REST_DELAY ?? 120)
const engine = process.env.ENGINE ?? 'webkit'
const browser = await ({ chromium, webkit }[engine]).launch()
const results = [], failures = []
const cases = (process.env.CASES ?? 'administrator:390,leader:390,user:390,administrator:1440').split(',')
const onlySections = process.env.ONLY_SECTIONS?.split(',').filter(Boolean)
if (onlySections) assert.ok(onlySections.every(mode => ['calendar', 'activity', 'zone', 'assignment', 'settings'].includes(mode)))
const label = process.env.LABEL ?? 'sections-nov19'
assert.match(label, /^[a-z0-9-]+$/i)
const output = () => writeFileSync(`scratch/${label}.json`, JSON.stringify({ base, demoSupabase, engine, delay, stableWindowMs: 200, serviceWorkers: 'blocked', bytes: 'decoded REST response bodies, not billed egress', results, failures }, null, 2))
try {
  for (const spec of cases) {
    const [role, w] = spec.split(':'), width = Number(w)
    const actor = role === 'administrator' ? { name: '관리자' } : fixture.actors.find(a => a.role === role)
    assert.ok(actor)
    const context = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: 'Asia/Seoul', serviceWorkers: 'block' })
    const page = await context.newPage()
    const reads = [], errors = [], starts = new WeakMap(), pending = new Set(), headDone = new WeakSet()
    let lastActivity = performance.now(), actualRole
    page.on('request', request => { starts.set(request, performance.now()); pending.add(request); lastActivity = performance.now() })
    const end = request => { pending.delete(request); lastActivity = performance.now() }
    page.on('response', response => {
      const r = response.request(), url = new URL(r.url())
      if (r.method() !== 'HEAD' || !url.pathname.startsWith('/rest/v1/')) return
      headDone.add(r)
      reads.push({ path: url.pathname.slice(9), query: url.search, started: starts.get(r), finished: performance.now(), bytes: 0, status: response.status(), method: 'HEAD' })
      end(r)
    })
    page.on('requestfinished', async request => {
      try {
        if (headDone.has(request)) return
        const url = new URL(request.url())
        if (!url.pathname.startsWith('/rest/v1/')) return
        const response = await request.response()
        const body = [204, 205].includes(response.status()) ? Buffer.alloc(0) : await response.body()
        if (url.pathname.endsWith('/auth_login') && response.ok()) actualRole = JSON.parse(body.toString())[0]?.role
        reads.push({ path: url.pathname.slice(9), query: url.search, started: starts.get(request), finished: performance.now(), bytes: body.length, status: response.status(), method: request.method() })
      } catch (error) { errors.push(error.message) } finally { end(request) }
    })
    page.on('requestfailed', request => {
      if (!headDone.has(request) && new URL(request.url()).pathname.startsWith('/rest/v1/')) errors.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`)
      end(request)
    })
    page.on('pageerror', error => errors.push(error.message))
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.hostname.endsWith('.supabase.co')) {
        assert.equal(url.origin, env.VITE_SUPABASE_URL, 'Production traffic is forbidden')
        if (url.pathname.startsWith('/rest/v1/')) {
          assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || url.pathname.includes('/rpc/'), 'No table writes allowed')
          if (delay) await new Promise(resolve => setTimeout(resolve, delay))
        }
        return route.continue()
      }
      if (url.origin === base) return route.continue()
      return route.abort()
    })
    await context.routeWebSocket('**/*', socket => {
      assert.equal(new URL(socket.url()).hostname, new URL(demoSupabase).hostname, 'Non-demo websocket traffic is forbidden')
      socket.connectToServer()
    })
    await page.addInitScript(`window.__advanceReadyTiming = ${advanceReadyTiming.toString()}`)
    await page.addInitScript(() => {
      window.__startSectionAudit = (mode, expected) => {
        window.__sectionAudit = { started: performance.now(), ready: null, firstReady: null, readySince: null, wasReady: false, readinessLosses: 0, loadingFrames: 0, frames: 0, mode, expected }
      }
      window.__startSectionAudit('home', '/')
      window.__sectionReady = (mode, expected) => {
        const visible = s => [...document.querySelectorAll(s)].some(el => el.getClientRects().length)
        const pathMatches = location.pathname === expected || (mode === 'settings' && expected === '/settings' && location.pathname === '/settings/profile')
        if (!pathMatches || visible('.app-loading')) return false
        if ([...document.querySelectorAll('[role="status"],[role="alert"]')].some(el => el.getClientRects().length && /불러오|다시 시도/.test(el.textContent))) return false
        if (mode === 'editor') return visible('.asg-editor-footer')
        if (mode === 'detail') return visible('.gs-roster-heading')
        if (!visible('.bottom-nav,.desktop-sidebar-nav')) return false
        if (mode === 'home') return visible('.mobile-today-service-section,.gs-event-block,.home-main,.home-page,.home-service-list') || /오늘의 봉사/.test(document.body.innerText)
        if (mode === 'calendar') return [...document.querySelectorAll('h1,h2,h3')].some(el => el.getClientRects().length && /\d+년 \d+월/.test(el.textContent))
        if (mode === 'settings') return visible('.mobile-settings-profile') || !!document.querySelector('a[href="/settings/profile"]')
        if (mode === 'profile') return visible('.mobile-profile-page')
        if (mode === 'users') return visible('.mobile-users-list-card')
        if (mode === 'signup') return visible('.signup-request-tabs')
        if (mode === 'push') return /이 기기|알림.*받기/.test(document.body.innerText)
        if (mode === 'assignment') return visible('.la-page') || /인도자 선택/.test(document.body.innerText)
        if (mode === 'zone') return visible('button[aria-label="지도"],.tbl,.territory-page,.zone-card,.zone-page') || /전체 구역|전체 카드|구역 관리/.test(document.body.innerText)
        if (mode === 'activity') return visible('.mobile-territory-page,.my-service-page')
        return false
      }
      function frame() {
        const a = window.__sectionAudit
        if (a) {
          a.frames++
          if ([...document.querySelectorAll('.app-loading,[role="status"]')].some(el => el.getClientRects().length && (el.classList.contains('app-loading') || /불러오/.test(el.textContent)))) a.loadingFrames++
          window.__advanceReadyTiming(a, window.__sectionReady(a.mode, a.expected), performance.now())
        }
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    const settle = async () => {
      const entered = performance.now(), deadline = entered + 30000
      while (pending.size || performance.now() - Math.max(entered, lastActivity) < 600) {
        assert.ok(performance.now() < deadline, `Unsettled requests: ${pending.size}`)
        await page.waitForTimeout(50)
      }
    }
    const waitReady = () => page.waitForFunction(() => window.__sectionAudit && window.__sectionAudit.ready !== null, undefined, { timeout: 45000 })
    const nav = () => page.locator(width < 980 ? '.bottom-nav' : '.desktop-sidebar-nav')
    const go = text => nav().getByRole('button', { name: text, exact: true }).click()
    async function measure(name, mode, expected, action, reload = false) {
      await settle()
      if (!reload) await page.evaluate(({ mode, expected }) => {
        document.addEventListener('click', () => window.__startSectionAudit(mode, expected), { once: true, capture: true })
      }, { mode, expected })
      const start = performance.now()
      await action()
      await waitReady()
      await settle()
      await waitReady()
      const measured = reads.filter(r => r.started >= start).map(r => ({ ...r, started: Math.round(r.started - start), finished: Math.round(r.finished - start) }))
      const timing = await page.evaluate(() => window.__sectionAudit)
      assert.notEqual(timing.ready, null, 'Readiness was lost after the final stable interval')
      const row = { role, actualRole, width, name, readyMs: Math.round(timing.ready), firstReadyMs: Math.round(timing.firstReady), readinessLosses: timing.readinessLosses, dataReadyMs: Math.max(0, ...measured.map(r => r.finished)), loadingFrames: timing.loadingFrames, requests: measured.length, bytes: measured.reduce((sum, r) => sum + r.bytes, 0), reads: measured }
      results.push(row); output()
      console.log(JSON.stringify({ ...row, reads: undefined }))
    }
    try {
      await page.goto(base)
      await page.locator('#login-id').fill(actor.name)
      await page.locator('#pin').fill('0000')
      await page.locator('.login-form button[type="submit"]').click()
      await waitReady(); await settle()
      assert.equal(actualRole, role === 'administrator' ? 'admin' : role)
      await measure('home-cold', 'home', '/', () => page.reload({ waitUntil: 'domcontentloaded' }), true)
      if (process.env.ONLY_COLD === 'true') {
        if (process.env.COLD_CALENDAR === 'true') await measure('calendar-first', 'calendar', '/calendar', () => go('캘린더'))
        if (errors.length || reads.some(r => r.status >= 400)) failures.push({ role, width, errors, httpErrors: reads.filter(r => r.status >= 400).map(r => ({ path: r.path, status: r.status })) })
        continue
      }
      for (const [name, mode, path] of process.env.ONLY_EDITOR === 'true' ? [] : [['캘린더', 'calendar', '/calendar'], ['나의 봉사', 'activity', '/territory'], ['구역', 'zone', '/zone'], ['배정', 'assignment', '/assignment'], ['설정', 'settings', '/settings']]) {
        if (onlySections && !onlySections.includes(mode)) continue
        // Start each section from a fresh app/home store, not a previous section's full cache.
        if (mode !== 'calendar') { await go('홈'); await settle(); await page.reload(); await waitReady(); await settle() }
        if (!await nav().getByRole('button', { name, exact: true }).count()) { results.push({ role, width, name: mode, unavailableInRole: true }); output(); continue }
        await measure(`${mode}-first`, mode, path, () => go(name))
        await page.screenshot({ path: `scratch/${label}-${role}-${width}-${mode}.png` })
        await measure(`home-after-${mode}`, 'home', '/', () => go('홈'))
        await measure(`${mode}-repeat`, mode, path, () => go(name))
      }
      if (width < 980 && process.env.SUBSETTINGS === 'true' && !onlySections) {
        await go('설정'); await settle()
        await measure('profile-first', 'profile', '/profile', () => page.locator('.mobile-settings-profile').click())
        await page.getByRole('button', { name: '뒤로', exact: true }).click(); await settle()
        await measure('push-settings-first', 'push', '/notification-settings', () => page.getByRole('button', { name: /푸시 알림/ }).click())
        await page.getByRole('button', { name: '뒤로', exact: true }).click(); await settle()
        if (role === 'administrator') {
          await measure('users-settings-first', 'users', '/users', () => page.getByRole('button', { name: /^사용자\s/ }).click())
          await page.getByRole('button', { name: '뒤로', exact: true }).click(); await settle()
          await measure('signup-settings-first', 'signup', '/signup-requests', () => page.getByRole('button', { name: /가입 승인 관리/ }).click())
          await page.getByRole('button', { name: '뒤로', exact: true }).click(); await settle()
        }
      }
      if (role !== 'user' && !onlySections) {
        await go('홈'); await settle(); await page.reload(); await waitReady(); await settle()
        const entry = page.locator('.gs-event-block>button').first()
        if (await entry.count()) await entry.click()
        else await page.goto(`${base}${width < 980 ? '/' : '/calendar'}?openEvent=${fixture.eventIds[0]}`)
        {
          await page.locator('.gs-assignment-open').waitFor({ timeout: 45000 }); await settle()
          const path = new URL(page.url()).pathname
          for (const phase of ['first', 'repeat']) {
            await measure(`team-editor-${phase}`, 'editor', path, () => page.locator('.gs-assignment-open').click())
            await page.locator('.asg-editor-back').click(); await page.locator('.gs-assignment-open').waitFor(); await settle()
          }
        }
      }
      if (errors.length || reads.some(r => r.status >= 400)) failures.push({ role, width, errors, httpErrors: reads.filter(r => r.status >= 400).map(r => ({ path: r.path, status: r.status })) })
    } catch (error) {
      failures.push({ role, width, error: error.message, url: page.url(), errors, body: (await page.locator('body').innerText()).slice(0, 1800) })
      await page.screenshot({ path: `scratch/${label}-${role}-${width}-failure.png` })
      console.log(JSON.stringify({ role, width, failed: error.message }))
    } finally { output(); await context.close() }
  }
} finally { output(); await browser.close() }
