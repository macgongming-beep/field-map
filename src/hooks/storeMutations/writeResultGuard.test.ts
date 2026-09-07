import { describe, expect, test } from 'vitest'
import ts from 'typescript'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * PostgREST 는 RLS 로 대상 행이 가려진 UPDATE/DELETE 에 **오류가 아니라 0행**을 준다.
 * `.select()` 없이 `error` 만 보면 앱은 "저장했습니다" 를 띄우고 아무것도 안 바뀐다.
 * 8/30 봉사 때 겪은 "저장이 안 된다" 와 같은 모양인데 오류 로그조차 없어 더 찾기 어렵다.
 *
 * ⚠ 정규식으로 세다가 **16건을 놓쳤다** (중첩 함수·spread·여러 줄 체이닝).
 *   96 인 줄 알았는데 실제로는 112 였다. 그래서 TypeScript AST 로 센다.
 *
 * 지키는 것 둘:
 *   ① 이미 역할별 권한으로 좁힌 표는 **한 곳도 예외 없이** 결과를 확인한다
 *   ② 나머지는 지금 숫자를 상한으로 두고 **늘어나지 못하게** 한다 (줄면 상한을 낮춘다)
 */
const DIR = 'src/hooks/storeMutations'
const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete'])

/** 역할별 권한으로 이미 좁힌 표 — 0행은 "권한 없음" 이므로 반드시 잡아야 한다 */
const NARROWED_TABLES = new Set([
  'login_logs', 'special_periods', 'chat_room_mutes', 'comments',
  'territory_regions', 'service_suggestions', 'informal_groups', 'informal_assets',
  'phone_surveys', 'review_tasks', 'restaurant_requests',
  'calendar_events', 'return_visit_logs',
])

/** 아직 TEMP 관문인 표들의 현재 위반 수. **줄이기만 한다.** */
const REMAINING_MAX = 103

type Violation = { file: string; line: number; table: string }

/** 체인의 뿌리에서 `.from('테이블')` 을 찾는다 */
function tableOfChain(node: ts.Node): string | null {
  let cur: ts.Node = node
  while (ts.isCallExpression(cur) || ts.isPropertyAccessExpression(cur)) {
    if (
      ts.isCallExpression(cur)
      && ts.isPropertyAccessExpression(cur.expression)
      && cur.expression.name.text === 'from'
      && cur.arguments.length > 0
      && ts.isStringLiteralLike(cur.arguments[0])
    ) return cur.arguments[0].text
    cur = cur.expression
  }
  return null
}

/** 이 쓰기 호출 뒤에 `.select(` 가 이어 붙는지 */
function chainHasSelect(call: ts.CallExpression): boolean {
  let p: ts.Node = call
  while (p.parent && (ts.isPropertyAccessExpression(p.parent) || ts.isCallExpression(p.parent))) {
    if (ts.isPropertyAccessExpression(p.parent) && p.parent.name.text === 'select') return true
    p = p.parent
  }
  return false
}

function findViolations(): Violation[] {
  const out: Violation[] = []
  for (const name of readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const src = ts.createSourceFile(
      name, readFileSync(join(DIR, name), 'utf-8'), ts.ScriptTarget.Latest, true,
    )
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && WRITE_METHODS.has(node.expression.name.text)
      ) {
        const table = tableOfChain(node.expression.expression)
        if (table && !chainHasSelect(node)) {
          out.push({
            file: name,
            line: src.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            table,
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(src)
    }
  return out
}

describe('쓰기 결과 확인 감시', () => {
  const violations = findViolations()

  test('감시식이 실제로 무언가를 보고 있다', () => {
    // 파서가 깨져 0건이 되면 아래 두 시험이 통째로 헛돈다.
    expect(violations.length).toBeGreaterThan(0)
  })

  test('감시식이 `.select()` 붙은 쓰기를 위반으로 세지 않는다', () => {
    // 반대 방향도 확인한다 — 전부 위반으로 세면 ①이 통과해도 의미가 없다.
    expect(violations.some((v) => v.table === 'special_periods')).toBe(false)
  })

  test('역할별 권한으로 좁힌 표는 쓰기 결과를 반드시 확인한다', () => {
    const bad = violations.filter((v) => NARROWED_TABLES.has(v.table))
    expect(bad.map((v) => `${v.file}:${v.line} ${v.table}`)).toEqual([])
  })

  test('나머지 표의 위반은 늘어나지 않는다', () => {
    const rest = violations.filter((v) => !NARROWED_TABLES.has(v.table))
    // 줄었다면 REMAINING_MAX 를 그 숫자로 낮춘다 (래칫).
    expect(rest.length).toBeLessThanOrEqual(REMAINING_MAX)
  })
})
