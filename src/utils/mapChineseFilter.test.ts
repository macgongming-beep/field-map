import { afterEach, expect, test, vi } from 'vitest'
import { testBuilding, testUnit } from '../test/territoryFixture'
import { chineseMapBuildings, mapChineseFilterEnabled } from './mapChineseFilter'

afterEach(() => vi.unstubAllEnvs())
test.each([
  [undefined, undefined, false], ['false', 'true', false],
  ['true', 'false', true], [undefined, 'true', true],
])('flag %s demo %s gives %s', (flag, demo, expected) => {
  vi.stubEnv('VITE_MAP_CHINESE_FILTER_ENABLED', flag)
  vi.stubEnv('VITE_DEMO_MODE', demo)
  expect(mapChineseFilterEnabled()).toBe(expected)
})

test('only explicit Chinese flags enter a display copy; source, warnings and unknown survey stay intact', () => {
  const source = [testBuilding(1, 1, 'mixed', [
    testUnit(1, '101', { isChinese: true, isRegularVisit: true, memo: 'keep' }),
    testUnit(2, '102', { isChinese: false, memo: 'also keep' }),
    testUnit(3, '103'), testUnit(4, '출입불가', { isChinese: true }),
  ]), testBuilding(2, 1, 'empty', [])]
  source[0].warning = 'blocked'; source[0].accessStatus = 'blocked'
  const before = structuredClone(source)
  expect(chineseMapBuildings(source, false)).toBe(source)
  const projected = chineseMapBuildings(source, true)
  expect(projected).toHaveLength(1)
  expect(projected[0].units.map(u => u.id)).toEqual([1])
  expect(projected[0]).toMatchObject({ warning: 'blocked', accessStatus: 'blocked' })
  expect(projected[0].unitsSurveyed).toBeUndefined()
  expect(projected[0]).not.toBe(source[0])
  expect(source).toEqual(before)
})
