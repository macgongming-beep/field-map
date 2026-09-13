// 테스트가 운영 DB 를 건드리지 못하게 막는다.
//
// 이 앱은 브라우저가 Supabase 에 직접 붙는다. 환경변수 하나를 잘못 읽으면
// 그 즉시 80명이 쓰는 데이터에 건물을 만들고 방문 기록을 지운다.
// "조심하자" 로는 못 막는다 — 코드가 막아야 한다.
//
// 규칙 셋:
//   ① 테스트는 .env.test.local 만 읽는다 (.env.local 은 쳐다보지 않는다)
//   ② 그 안의 project ref 가 운영과 같으면 그 자리에서 죽는다
//   ③ 쓰기 테스트는 PLAYWRIGHT_ALLOW_WRITES=true 가 있어야만 돈다
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Supabase URL 에서 project ref 를 뽑는다. https://<ref>.supabase.co */
export function projectRefOf(url) {
  return String(url ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\./)?.[1] ?? null
}

// 운영 project ref 는 커밋해 둔다.
//
// 비밀이 아니다 — 이 주소는 어차피 클라이언트 번들에 들어가 공개돼 있다.
// 여기 적어 두는 이유는 CI 때문이다. supabase/.temp/ 와 .env.local 은 둘 다
// gitignore 라서, 새로 clone 한 CI 에는 대조할 상대가 없다. 그러면 가드가
// "못 찾겠다" 며 통과시켜 버린다 — 막으려던 바로 그 상황에서 무력해진다.
//
// 회중을 늘리면 그 ref 도 여기 추가한다. 하나라도 빠지면 그 DB 는 안 지켜진다.
export const KNOWN_PRODUCTION_REFS = [
  'qdxemvdorasoryfysuoq',   // 용인 중국어 (운영)
]

// 쓰기가 허용된 테스트 프로젝트. **여기 없으면 못 쓴다.**
//
// 운영 목록으로 막는 방식은 위험하다 — 회중을 늘렸는데 그 ref 를 위에 적는 걸
// 잊으면, 그 회중의 운영 DB 가 "운영이 아니다" 로 통과해 테스트가 쓰기를 한다.
// 빠뜨리는 쪽이 안전한 결과를 내야 한다. 그래서 허용목록으로 뒤집었다.
export const KNOWN_TEST_REFS = [
  'itjlykpjmlcvanqpmkmc',   // field-map-test (2026-08-24 생성, Singapore)
]

/** 운영 project ref. supabase link 정보가 진짜 출처다. */
export function productionRef() {
  const linked = join(root, 'supabase/.temp/project-ref')
  if (existsSync(linked)) {
    const ref = readFileSync(linked, 'utf8').trim()
    if (ref) return ref
  }
  // link 정보가 없으면 .env.local 을 본다 — 값을 쓰려는 게 아니라
  // "이건 운영이다" 라고 판정하기 위해서만 읽는다.
  const envLocal = join(root, '.env.local')
  if (existsSync(envLocal)) {
    return projectRefOf(readFileSync(envLocal, 'utf8').match(/^VITE_SUPABASE_URL=(.*)$/m)?.[1])
  }
  return null
}

/** 이 ref 가 알려진 운영 DB 중 하나인가 */
export function isProductionRef(ref) {
  if (!ref) return false
  if (KNOWN_PRODUCTION_REFS.includes(ref)) return true
  return ref === productionRef()
}

function parseEnv(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

/**
 * 테스트 환경을 읽고 검사한다. 운영이면 프로세스를 죽인다.
 * @returns {{ url: string, anonKey: string, ref: string, allowWrites: boolean, loginId: string, loginPin: string }}
 */
export function loadTestEnv() {
  const file = join(root, '.env.test.local')

  if (!existsSync(file)) {
    console.error('✗ .env.test.local 이 없다.')
    console.error('')
    console.error('  테스트는 운영과 다른 Supabase 프로젝트를 봐야 한다.')
    console.error('  .env.test.example 을 복사해 테스트 프로젝트 값을 채울 것.')
    console.error('')
    console.error('  ⚠ .env.local 을 복사하지 말 것 — 그건 운영이다.')
    process.exit(1)
  }

  const env = parseEnv(readFileSync(file, 'utf8'))
  const url = env.VITE_SUPABASE_URL
  const ref = projectRefOf(url)
  const prod = productionRef() ?? KNOWN_PRODUCTION_REFS[0]
  const loginId = env.TEST_LOGIN_ID
  const loginPin = env.TEST_LOGIN_PIN

  if (!url || !ref) {
    console.error('✗ .env.test.local 의 VITE_SUPABASE_URL 이 비었거나 형식이 이상하다.')
    process.exit(1)
  }

  if (!loginId || !loginPin) {
    console.error('✗ .env.test.local 의 TEST_LOGIN_ID / TEST_LOGIN_PIN 이 비었습니다.')
    console.error('  외부에 공개되는 테스트 개발자 비밀번호를 코드에 기본값으로 두지 않습니다.')
    process.exit(1)
  }

  // ── 여기가 핵심이다 ─────────────────────────────────────────────
  if (isProductionRef(ref)) {
    console.error('')
    console.error('  ╔══════════════════════════════════════════════════════╗')
    console.error('  ║  테스트가 운영 DB 를 가리키고 있다. 중단한다.        ║')
    console.error('  ╚══════════════════════════════════════════════════════╝')
    console.error('')
    console.error(`  .env.test.local 의 project ref : ${ref}`)
    console.error(`  이 ref 는 운영 DB 로 등록돼 있다.`)
    console.error('')
    console.error('  이대로 돌리면 80명이 쓰는 데이터에 쓰기가 일어난다.')
    console.error('  테스트용 Supabase 프로젝트를 따로 만들어 그 값을 넣을 것.')
    console.error('')
    process.exit(1)
  }

  // 쓰기는 등록된 테스트 프로젝트에만. 둘 다 만족해야 한다.
  const wantsWrites = process.env.PLAYWRIGHT_ALLOW_WRITES === 'true'
  const registered = KNOWN_TEST_REFS.includes(ref)

  if (wantsWrites && !registered) {
    console.error('')
    console.error('  ╔══════════════════════════════════════════════════════╗')
    console.error('  ║  등록되지 않은 프로젝트에 쓰기를 하려 했다. 중단.    ║')
    console.error('  ╚══════════════════════════════════════════════════════╝')
    console.error('')
    console.error(`  project ref : ${ref}`)
    console.error('')
    console.error('  쓰기는 KNOWN_TEST_REFS 에 적힌 프로젝트에만 허용된다.')
    console.error('  운영 목록으로 막으면, 새 회중 ref 를 적는 걸 잊었을 때')
    console.error('  그 운영 DB 가 통과해 버린다. 빠뜨리면 막히는 쪽이 맞다.')
    console.error('')
    console.error('  정말 테스트 프로젝트라면 scripts/testEnvGuard.js 의')
    console.error('  KNOWN_TEST_REFS 에 만든 날짜와 함께 추가할 것.')
    console.error('')
    process.exit(1)
  }

  return {
    url,
    anonKey: env.VITE_SUPABASE_ANON_KEY ?? '',
    ref,
    allowWrites: wantsWrites && registered,
    loginId,
    loginPin,
  }
}
