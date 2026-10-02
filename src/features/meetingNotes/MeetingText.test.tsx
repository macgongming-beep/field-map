// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MeetingText } from './MeetingText'

afterEach(cleanup)
const url = 'https://www.jw.org/cmn-hans/多媒体图书馆/影片/耶稣的一生/影片/'

it('renders the pasted Chinese-path Markdown link once and opens it safely', () => {
  render(<MeetingText text={`## 3. 휴대폰으로 예고편을 보여 줍니다\n\n([${url}](${url}))`} />)
  const link = screen.getByRole('link', { name: url })
  expect(screen.getAllByRole('link')).toHaveLength(1)
  expect(link.getAttribute('href')).toBe(new URL(url).href)
  expect(link.getAttribute('target')).toBe('_blank')
  expect(link.getAttribute('rel')).toBe('noopener noreferrer')
})

it('supports named links and bare URLs in paragraphs, lists, quotes and headings', () => {
  render(<MeetingText text={`[예고편 보기](${url})\n\n- ${url}\n\n> [观看预告片](${url})\n\n## [영상](${url})`} />)
  expect(screen.getAllByRole('link')).toHaveLength(4)
  expect(screen.getByRole('link', { name: '예고편 보기' })).toBeTruthy()
  expect(screen.getByRole('link', { name: '观看预告片' })).toBeTruthy()
})

it('never creates executable links or interprets HTML', () => {
  const { container } = render(<MeetingText text={'[bad](javascript:alert(1))\n\n[bad](data:text/html,test)\n\n<img src=x onerror=alert(1)>\n\n[<script>alert(1)</script>](https://example.com)'} />)
  expect(container.querySelector('script,img')).toBeNull()
  expect(screen.getAllByRole('link')).toHaveLength(1)
  expect(screen.getByRole('link').getAttribute('href')).toBe('https://example.com/')
})
