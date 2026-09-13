// request.headers 가 ① RPC 안 ② **정책 안** 에서 실제로 오는지 증명한다.
// SQL Editor 의 set_config 흉내로는 증명이 안 된다 — 진짜 HTTP 요청이어야 한다.
//
// 테스트 DB 에서만 돈다.
import { loadTestEnv } from './testEnvGuard.js'

const env = loadTestEnv()
if (!env.allowWrites) {
  console.error('\n  ✗ 이 smoke 는 쓴다. npm run smoke:headers 로 실행할 것.\n')
  process.exit(1)
}
const URL_ = env.url
const KEY = env.anonKey

let fail = 0
const check = (name, ok, detail) => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) fail += 1
}
const call = (path, init = {}, token) =>
  fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY, 'Content-Type': 'application/json',
      ...(token ? { 'x-session-token': token } : {}),
      ...(init.headers ?? {}),
    },
  })

const main = async () => {
  console.log('\n── request.headers 가 실제로 오는가 ──\n')

  // ① RPC 안에서 헤더가 보이나
  const r1 = await call('rpc/_probe_headers', { method: 'POST', body: '{}' }, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  const headers = await r1.json().catch(() => null)
  check('RPC 안에서 request.headers 가 온다',
    r1.status === 200 && headers && typeof headers === 'object',
    `HTTP ${r1.status}`)
  check('그 안에 x-session-token 이 있다',
    Boolean(headers?.['x-session-token']),
    headers ? `키 ${Object.keys(headers).length}개` : '')

  // ② 진짜 토큰을 받아 온다
  const lg = await fetch(`${URL_}/rest/v1/rpc/auth_login`, {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_login_id: env.loginId, p_pin: env.loginPin }),
  })
  const lgData = await lg.json().catch(() => null)
  const token = Array.isArray(lgData) ? lgData[0]?.token : lgData?.token
  check('테스트 관리자로 로그인된다', Boolean(token), token ? '' : JSON.stringify(lgData).slice(0, 80))
  if (!token) { process.exit(1) }

  // ③ **정책 안에서** 헤더가 읽히나 — 이게 진짜 질문이다
  const noHeader = await call('_probe_gate', { method: 'POST', body: JSON.stringify({ memo: '헤더없음' }) })
  check('헤더 없이 쓰면 막힌다', noHeader.status === 401 || noHeader.status === 403,
    `HTTP ${noHeader.status}`)

  const badToken = await call('_probe_gate', { method: 'POST', body: JSON.stringify({ memo: '엉터리' }) },
    'not-a-uuid')
  check('형식이 이상한 토큰도 막힌다 (예외 아님)',
    badToken.status === 401 || badToken.status === 403, `HTTP ${badToken.status}`)

  const fakeToken = await call('_probe_gate', { method: 'POST', body: JSON.stringify({ memo: '가짜' }) },
    '00000000-0000-0000-0000-000000000000')
  check('없는 토큰도 막힌다', fakeToken.status === 401 || fakeToken.status === 403,
    `HTTP ${fakeToken.status}`)

  const good = await call('_probe_gate', { method: 'POST', body: JSON.stringify({ memo: '진짜' }) }, token)
  check('진짜 토큰이면 쓸 수 있다', good.status === 201 || good.status === 200,
    `HTTP ${good.status} ${good.status >= 400 ? await good.text() : ''}`)

  // ④ 뒷정리
  await call('_probe_gate?memo=neq.zzz', { method: 'DELETE' }, token).catch(() => {})

  console.log(fail === 0
    ? '\n  전부 통과 — 헤더 방식이 성립한다\n'
    : `\n  ${fail}개 실패 — 헤더 방식은 이대로는 안 된다\n`)
  process.exit(fail === 0 ? 0 : 1)
}
main()
