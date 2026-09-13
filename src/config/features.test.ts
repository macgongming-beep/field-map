import { describe, expect, test } from 'vitest'
import { CART_APPLICATIONS_ENABLED } from './features'

describe('optional feature defaults', () => {
  test('전시대 신청은 환경변수 없이 활성화되지 않는다', () => {
    expect(CART_APPLICATIONS_ENABLED).toBe(false)
  })
})
