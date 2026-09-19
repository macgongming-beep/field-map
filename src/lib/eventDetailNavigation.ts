export const EVENT_DETAIL_RETURN_TO = 'eventDetailReturnTo'

type AppLocation = {
  pathname: string
  search: string
  hash: string
}

export function getCurrentAppPath(location: AppLocation): string {
  return `${location.pathname}${location.search}${location.hash}`
}

export function readEventDetailReturnTo(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null

  const target = (state as Record<string, unknown>)[EVENT_DETAIL_RETURN_TO]
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')) {
    return null
  }

  // 상세 링크 자체를 복귀 경로로 저장하면 닫자마자 다시 열리는 순환이 생긴다.
  if (target.includes('openEvent=')) return null
  return target
}

export function getEventDetailReturnTo(state: unknown): string {
  return readEventDetailReturnTo(state) ?? '/calendar'
}

export function eventDetailNavigationState(location: AppLocation) {
  return { [EVENT_DETAIL_RETURN_TO]: getCurrentAppPath(location) }
}
