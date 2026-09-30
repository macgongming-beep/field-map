import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { scrubSecrets } from './sentry'

const TOKEN = '3f2a9c1e-7b4d-4e8a-9f10-2c3d4e5f6a7b'

describe('Sentry 로 보내는 기록에서 세션 토큰을 가린다', () => {
  test('콘솔 breadcrumb 안의 토큰을 가린다', () => {
    const crumb = { category: 'console', message: `[x] token: ${TOKEN}`, data: { arguments: ['token:', TOKEN] } }
    const scrubbed = scrubSecrets(crumb)
    expect(JSON.stringify(scrubbed)).not.toContain(TOKEN)
    expect(scrubbed.message).toBe('[x] token: [redacted]')
  })

  test('오류 이벤트의 요청 본문·추가 정보 안의 토큰도 가린다', () => {
    const event = { request: { data: `{"p_token":"${TOKEN.toUpperCase()}"}` }, extra: { nested: [{ t: TOKEN }] } }
    expect(JSON.stringify(scrubSecrets(event)).toLowerCase()).not.toContain(TOKEN)
  })

  test('토큰이 없는 기록은 그대로 둔다', () => {
    const crumb = { category: 'navigation', data: { from: '/map', to: '/zone' } }
    expect(scrubSecrets(crumb)).toEqual(crumb)
  })
})

describe('개인정보 노출 감시', () => {
  test('오류 리플레이는 화면 글자·입력·사진을 가린다', () => {
    const source = readFileSync(join(__dirname, 'sentry.ts'), 'utf8')
    expect(source).toMatch(/maskAllText:\s*true/)
    expect(source).toMatch(/maskAllInputs:\s*true/)
    expect(source).toMatch(/blockAllMedia:\s*true/)
    expect(source).toMatch(/beforeBreadcrumb:/)
    expect(source).toMatch(/beforeSend:/)
  })

  test('세션 토큰 변수를 콘솔에 찍지 않는다', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) { walk(path); continue }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue
        readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
          if (/console\.\w+\(.*\btoken\s*[,)]/i.test(line)) {
            offenders.push(`${path}:${index + 1}`)
          }
        })
      }
    }
    walk(join(__dirname, '..'))
    expect(offenders).toEqual([])
  })
})
