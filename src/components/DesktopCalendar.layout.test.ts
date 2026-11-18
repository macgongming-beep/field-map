import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('calendar responsive layout contracts', () => {
  const css = readFileSync('src/App.css', 'utf8')
  const mobile = readFileSync('src/components/admin/AdminEventDetailSheet.tsx', 'utf8')

  it('scopes shrinking columns and the stacked layout to the calendar', () => {
    expect(css).toMatch(/\.desktop-content\.calendar-layout\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(320px, 430px\)/)
    expect(css).toMatch(/@media \(max-width: 1199px\)\s*\{\s*\.desktop-content\.calendar-layout\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/)
    expect(css).toMatch(/\.calendar-layout \.page-header-actions\s*\{[^}]*flex-wrap:\s*wrap/)
  })

  it('wraps unbroken event titles without shrinking their font', () => {
    expect(css).toMatch(/\.event-hero-title\s*\{[^}]*overflow-wrap:\s*anywhere/)
    expect(mobile).toMatch(/<h1 className="event-detail-title"[^>]*fontSize: 26[^>]*overflowWrap: 'anywhere'/)
  })

  it('gives dropdown items priority over the white detail header button style', () => {
    expect(css).toMatch(/\.event-dots-dropdown \.event-dots-item\s*\{[^}]*padding:\s*8px 10px[^}]*color:\s*var\(--gray-700\)/)
  })

  it('keeps the schedule menu trigger legible and easy to target', () => {
    expect(css).toMatch(/\.event-dots-btn\s*\{[^}]*width:\s*40px[^}]*height:\s*40px[^}]*color:\s*var\(--ink\)/)
  })
})
