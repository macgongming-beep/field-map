import { describe, expect, it } from 'vitest'
import {
  eventDetailNavigationState,
  getCurrentAppPath,
  homeEventDetailId,
  readEventDetailReturnTo,
} from './eventDetailNavigation'

describe('event detail return navigation', () => {
  it('recognizes only valid home detail entries', () => {
    expect(homeEventDetailId('/', '?openEvent=17')).toBe(17)
    expect(homeEventDetailId('/home', '?openEvent=17')).toBe(17)
    for (const search of ['', '?openEvent=0', '?openEvent=-1', '?openEvent=1.5', '?openEvent=bad', '?openEvent=9007199254740992', '?openEvent=17&openChat=17']) {
      expect(homeEventDetailId('/', search)).toBeNull()
    }
    expect(homeEventDetailId('/calendar', '?openEvent=17')).toBeNull()
  })
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
