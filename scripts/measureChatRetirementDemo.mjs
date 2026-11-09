// Real React hook + Supabase client, real elapsed time. This is not a physical phone test.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { rolldown } from 'rolldown'
import { createClient } from '@supabase/supabase-js'

const config = parseEnv(readFileSync(process.env.DEMO_ENV_FILE, 'utf8'))
const origin = 'https://itjlykpjmlcvanqpmkmc.supabase.co'
assert.equal(config.VITE_SUPABASE_URL, origin)
assert.ok(process.argv.includes('--confirm-demo'))
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const name of ['window','document','navigator','localStorage','sessionStorage','HTMLElement','CustomEvent']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const requests = [], channels = []
const client = createClient(origin, config.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: {
  fetch: (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    assert.equal(url.origin, origin)
    requests.push({ path: url.pathname, query: url.search, method: init?.method ?? 'GET' })
    return fetch(input, init)
  },
} })
const { data, error } = await client.rpc('auth_login', { p_login_id: '봉사자', p_pin: '0000' })
assert.equal(error, null)
assert.ok(data?.[0]?.token)
const actor = data[0]
localStorage.setItem('auth_token', actor.token)
requests.length = 0
const channel = client.channel.bind(client)
client.channel = (...args) => { channels.push(args[0]); return channel(...args) }
globalThis.__chatProbe = { client }
const bundle = await rolldown({ input: '\0chat-probe', transform: { define: { 'import.meta.env': JSON.stringify({
  DEV: false, VITE_DEMO_MODE: 'true', VITE_CHAT_DISABLED: 'true', VITE_SUPABASE_URL: origin,
}) } }, plugins: [{ name: 'chat-probe', resolveId(id) {
  if (id === '\0chat-probe') return id
  if (id.endsWith('/supabase')) return '\0chat-client'
  if (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0')) return { id: import.meta.resolve(id), external: true }
}, load(id) {
  if (id === '\0chat-client') return 'export const supabase=globalThis.__chatProbe.client'
  if (id === '\0chat-probe') return `
    export { useUserChats } from ${JSON.stringify(resolve('src/hooks/useUserChats.ts'))};
    export { NotificationCenter } from ${JSON.stringify(resolve('src/components/NotificationCenter.tsx'))};
    export { GlobalChatModal } from ${JSON.stringify(resolve('src/components/GlobalChatModal.tsx'))};
    export { ChatRoom } from ${JSON.stringify(resolve('src/components/ChatRoom.tsx'))};`
} }] })
const { output } = await bundle.generate({ format: 'esm', codeSplitting: false })
const mod = await import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`)
const React = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { render, renderHook, act, cleanup } = await import('@testing-library/react')
const noop = async () => {}
const hooks = [false, true].map(badgeOnly => renderHook(() => mod.useUserChats(actor.id, actor.name, { badgeOnly })))
render(React.createElement(mod.GlobalChatModal, { userId: actor.id, userName: actor.name, onClose: noop }))
render(React.createElement(mod.ChatRoom, { currentUserId: actor.id, currentVisitor: actor.name, eventId: 1, eventTitle: 'probe' }))
render(React.createElement(MemoryRouter, null, React.createElement(mod.NotificationCenter, {
  userId: actor.id, userName: actor.name, notifications: [], onClose: noop, markRead: noop, markAllRead: noop,
})))
const start = Date.now()
console.log('Started 10-minute real-time disabled chat probe (hook, badge, modal, notification center).')
try {
  for (let minute = 0; minute < 10; minute++) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 60_000))
      document.dispatchEvent(new dom.window.Event('visibilitychange'))
      window.dispatchEvent(new dom.window.Event('online'))
      await Promise.all(hooks.map(h => h.result.current.refetch({ force: true })))
    })
    assert.equal(requests.length, 0)
    assert.equal(channels.length, 0)
    console.log(`Minute ${minute + 1}: requests=0 channels=0`)
  }
  const result = { elapsedMs: Date.now() - start, requests, channels, environment: 'jsdom React components + real Supabase client, real timers' }
  writeFileSync('scratch/chat-retirement-ten-minute-results.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally { cleanup(); await client.removeAllChannels(); dom.window.close(); await bundle.close() }
