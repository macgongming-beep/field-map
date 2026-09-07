import { describe, expect, test } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/hooks/useAuth.ts', 'utf8')
const file = ts.createSourceFile('useAuth.ts', source, ts.ScriptTarget.Latest, true)
const writes: Array<{ line: number; hasSelect: boolean }> = []

function tableOfChain(node: ts.Node): string | null {
  let current = node
  while (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current)) {
    if (
      ts.isCallExpression(current)
      && ts.isPropertyAccessExpression(current.expression)
      && current.expression.name.text === 'from'
      && ts.isStringLiteralLike(current.arguments[0])
    ) return current.arguments[0].text
    current = current.expression
  }
  return null
}

function chainHasSelect(call: ts.CallExpression): boolean {
  let current: ts.Node = call
  while (current.parent && (ts.isCallExpression(current.parent) || ts.isPropertyAccessExpression(current.parent))) {
    if (ts.isPropertyAccessExpression(current.parent) && current.parent.name.text === 'select') return true
    current = current.parent
  }
  return false
}

function visit(node: ts.Node): void {
  if (
    ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ['insert', 'update', 'delete', 'upsert'].includes(node.expression.name.text)
    && tableOfChain(node.expression.expression) === 'app_users'
  ) {
    writes.push({
      line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      hasSelect: chainHasSelect(node),
    })
  }
  ts.forEachChild(node, visit)
}
visit(file)

describe('사용자 쓰기 결과 확인', () => {
  test('app_users 직접 쓰기는 실제 영향 행을 돌려받는다', () => {
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.filter((item) => !item.hasSelect).map((item) => item.line)).toEqual([])
  })
})
