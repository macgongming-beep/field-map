export function chatDisabled(flag = import.meta.env.VITE_CHAT_DISABLED, demo = import.meta.env.VITE_DEMO_MODE): boolean {
  return (flag ?? demo) === 'true'
}

/** Only known chat routes, never a mention type alone. */
export function legacyChatEventId(link?: string | null): number | null {
  if (!link || !link.startsWith('/')) return null
  const url = new URL(link, 'https://app.invalid')
  if (url.origin !== 'https://app.invalid') return null
  const route = /^\/calendar\/events\/(\d+)\/chat\/?$/.exec(url.pathname)
  const ids = url.pathname === '/calendar' ? url.searchParams.getAll('openChat') : []
  const raw = route?.[1] ?? (ids.length === 1 ? ids[0] : null)
  if (!raw || !/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function isRetiredChatNotification(notification: { type: string; link?: string | null }): boolean {
  return notification.type === 'chat'
    || (notification.type === 'mention' && legacyChatEventId(notification.link) !== null)
}
