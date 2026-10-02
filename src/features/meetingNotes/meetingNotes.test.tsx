// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MeetingText } from './MeetingText'
import { MeetingHome, MeetingSuggestions } from './MeetingHome'
import { MeetingContext } from './context'
import { addDays, homeCollectionVisible, koreaDate, localizedMeeting, markNoteRead, readNoteVersion, meetingDateLabel, meetingListTitle, meetingDayParts } from './model'
import type { MeetingCollection, MeetingNoteMeta } from './model'

const group: MeetingCollection = { id: 1, nameKo: '순회방문', nameZh: '', startDate: '2020-01-01', endDate: '2099-01-01', homeVisibleUntil: '2099-01-15', homePosition: 'after_service', collapseSuggestions: true, updatedAt: 'v1' }
const note: MeetingNoteMeta = { id: 1, eventId: null, collectionId: 1, titleKo: '따뜻한 대화', titleZh: '', excerptKo: '발췌', excerptZh: '', readingMinutesKo: 3, readingMinutesZh: 1, date: '2026-10-01', time: '10:00', place: '장소', leader: '인도자', updatedAt: 'v1', archivedAt: null }
afterEach(() => { cleanup(); localStorage.clear() })

describe('meeting contracts', () => {
  it('shows a separate list topic without changing article titles', () => {
    const n = { ...note, listTitleKo: '열망 유지', listTitleZh: '保持热心' }
    expect(meetingListTitle(n, 'ko')).toBe('열망 유지')
    expect(meetingListTitle(n, 'zh')).toBe('保持热心')
    expect(meetingListTitle(note, 'ko')).toBe(note.titleKo)
    expect(n.titleKo).toBe('따뜻한 대화')
    expect(meetingDayParts('2026-10-01','ko')).toEqual({day:'10/1',weekday:'목'})
  })
  it('home off overrides dates and on still respects the display window', () => {
    const c = { ...group, startDate: '2026-09-29', endDate: '2026-10-04', homeVisibleUntil: '2026-10-18' }
    expect(homeCollectionVisible({...c, homeEnabled:false}, '2026-10-01')).toBe(false)
    expect(homeCollectionVisible({...c, homeEnabled:true}, '2026-10-01')).toBe(true)
    expect(homeCollectionVisible({...c, homeEnabled:true}, '2026-10-19')).toBe(false)
  })
  it('shows localized weekdays without shifting calendar dates', () => {
    expect(meetingDateLabel('2026-10-01', 'ko')).toBe('10월 1일 (목)')
    expect(meetingDateLabel('2026-10-01', 'en')).toContain('Thu')
    expect(meetingDateLabel('2026-10-01', 'zh')).toContain('周四')
  })
  it('includes start and last home date in Korean calendar time', () => {
    const c = { ...group, startDate: '2026-10-01', homeVisibleUntil: '2026-10-19' }
    expect(homeCollectionVisible(c, '2026-09-30')).toBe(false)
    expect(homeCollectionVisible(c, '2026-10-01')).toBe(true)
    expect(homeCollectionVisible(c, '2026-10-19')).toBe(true)
    expect(homeCollectionVisible(c, '2026-10-20')).toBe(false)
    expect(koreaDate(new Date('2026-09-30T15:00:00Z'))).toBe('2026-10-01')
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08')
  })
  it('falls back to Korean only when Chinese is absent', () => {
    expect(localizedMeeting('본문', '  ', 'zh')).toBe('본문')
    expect(localizedMeeting('본문', '正文', 'zh')).toBe('正文')
    expect(localizedMeeting('본문', '正文', 'ko')).toBe('본문')
  })
  it('keeps read state isolated by person and note revision', () => {
    markNoteRead(7, note)
    expect(readNoteVersion(7, 1)).toBe('v1')
    expect(readNoteVersion(8, 1)).toBe(null)
    expect(readNoteVersion(7, 1)).not.toBe('v2')
  })
  it('renders headings, lists, quotes but never interprets HTML', () => {
    const { container } = render(<MeetingText text={'## 소제목\n\n- 하나\n- 둘\n\n> 인용\n\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>'} />)
    expect(screen.getByRole('heading').textContent).toBe('소제목')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(container.querySelector('blockquote')?.textContent).toBe('인용')
    expect(container.querySelector('script,img')).toBe(null)
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy()
  })
  it('positions populated collections and collapses suggestions only when a note exists', () => {
    const renderHome = (notes: MeetingNoteMeta[]) => <MemoryRouter><MeetingContext.Provider value={{ userId: 7, canManage: false, refresh: () => {}, data: { collections: [group], notes } }}><MeetingHome language="ko" position="top" /><span>오늘 봉사</span><MeetingHome language="ko" position="after_service" /><MeetingSuggestions language="ko"><p>제안 본문</p></MeetingSuggestions></MeetingContext.Provider></MemoryRouter>
    const { container, rerender } = render(renderHome([]))
    expect(screen.queryByText('순회방문')).toBe(null)
    expect(container.querySelector('details')).toBe(null)
    rerender(renderHome([note]))
    expect(screen.getAllByText('순회방문')).toHaveLength(1)
    expect(screen.queryByText('따뜻한 대화')).toBe(null)
    expect(container.textContent).not.toContain('인도자')
    expect(container.querySelector('.meeting-dates')).toBe(null)
    rerender(renderHome([note, { ...note, id: 2, date: '2026-10-02' }]))
    expect(container.querySelectorAll('.meeting-home button')).toHaveLength(1)
    expect(container.querySelector('.meeting-dates')).toBe(null)
    expect(screen.getByText('오늘 봉사').compareDocumentPosition(screen.getByText('순회방문')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('details')?.open).toBe(false)
  })
})
