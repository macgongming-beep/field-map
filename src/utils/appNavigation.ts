import { chatDisabled, legacyChatEventId } from '../lib/chatRetirement'

export function normalizeAppLink(link: string | null | undefined): string | null {
  const rawLink = link?.trim()
  if (!rawLink) return null

  let path = rawLink
  try {
    const url = new URL(rawLink, window.location.origin)
    if (url.origin === window.location.origin) {
      path = `${url.pathname}${url.search}${url.hash}`
    }
  } catch {
    path = rawLink
  }

  if (!path.startsWith('/')) path = `/${path}`

  const legacyId = chatDisabled() ? legacyChatEventId(path) : null
  if (legacyId !== null) return `/calendar?openEvent=${legacyId}`

  const calendarChatMatch = path.match(/^\/calendar\/events\/(\d+)\/chat\/?$/)
  if (calendarChatMatch) return `/calendar?openChat=${calendarChatMatch[1]}`

  const calendarEventMatch = path.match(/^\/calendar\/events\/(\d+)\/?$/)
  if (calendarEventMatch) return `/calendar?${chatDisabled() ? 'openEvent' : 'openChat'}=${calendarEventMatch[1]}`

  const noticeMatch = path.match(/^\/notices\/(\d+)\/?$/)
  if (noticeMatch) return `/notices?noticeId=${noticeMatch[1]}`

  return path
}
