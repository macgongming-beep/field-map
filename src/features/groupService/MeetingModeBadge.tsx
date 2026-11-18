import type { CalendarEvent } from '../../types'
import { msg } from '../../lib/msg'
import { serviceMeetingMode } from './model'

export function MeetingModeBadge({event}:{event:CalendarEvent}) {
  const mode=serviceMeetingMode(event)
  if(mode==='none')return null
  return <span className="gs-meeting-badge" title={msg(mode==='virtual'?'화상 모임':'현장 모임')}>
    {msg(mode==='virtual'?'线上':'现场')}
  </span>
}
