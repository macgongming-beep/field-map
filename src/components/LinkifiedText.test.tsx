import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LinkifiedText } from './LinkifiedText'

describe('LinkifiedText', () => {
  it('URL과 전화번호를 각각 알맞은 링크로 만든다', () => {
    render(<LinkifiedText text="지도 https://naver.me/example 전화 010-1234-5678" />)

    expect(screen.getByRole('link', { name: 'https://naver.me/example' }).getAttribute('href')).toBe('https://naver.me/example')
    expect(screen.getByRole('link', { name: '010-1234-5678 전화 걸기' }).getAttribute('href')).toBe('tel:01012345678')
  })
})
