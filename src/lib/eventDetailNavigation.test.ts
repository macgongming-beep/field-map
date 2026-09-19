import { describe, expect, it } from 'vitest'
import {
  eventDetailNavigationState,
  getCurrentAppPath,
  readEventDetailReturnTo,
} from './eventDetailNavigation'

describe('event detail return navigation', () => {
  it('keeps the exact screen that opened the event detail', () => {
    const location = { pathname: '/zone', search: '?scope=cards', hash: '#active' }

    expect(getCurrentAppPath(location)).toBe('/zone?scope=cards#active')
    expect(readEventDetailReturnTo(eventDetailNavigationState(location))).toBe('/zone?scope=cards#active')
  })

  it('rejects external and recursive return targets', () => {
    expect(readEventDetailReturnTo({ eventDetailReturnTo: '//outside.example' })).toBeNull()
    expect(readEventDetailReturnTo({ eventDetailReturnTo: '/calendar?openEvent=17' })).toBeNull()
    expect(readEventDetailReturnTo({ eventDetailReturnTo: 'https://outside.example' })).toBeNull()
  })
})
