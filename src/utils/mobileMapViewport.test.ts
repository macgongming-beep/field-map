import { describe, expect, test } from 'vitest'
import { getMobileMapSelectedPeekHeight } from './mobileMapViewport'

describe('selected building peek', () => {
  test.each([[568, 170], [667, 170], [844, 185], [932, 199], [1200, 200]])(
    'keeps a readable compact summary at viewport %i',
    (viewport, expected) => {
      expect(getMobileMapSelectedPeekHeight(viewport)).toBe(expected)
      expect(getMobileMapSelectedPeekHeight(viewport)).toBeLessThan(viewport * 0.46)
    },
  )
})
