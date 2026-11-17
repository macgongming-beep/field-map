import type { CalendarEvent } from '../../types'
import type { ServicePayload } from './model'

// Match private.service_event_notify; memo and assignment metadata are not notifications.
export function serviceEventChanged(before:CalendarEvent,after:ServicePayload) {
  const values:[unknown,unknown][]=[
    [before.date,after.event_date],[before.time,after.time],[before.endTime,after.end_time],
    [before.title,after.title],[before.place,after.place],[before.leader,after.leader_name],
    [before.mapLink,after.meeting_map_url],[before.meetingMode,after.meeting_mode],
    [before.serviceKind,after.service_kind],[before.primaryLeaderUserId,after.primary_leader_user_id],
    [before.allowApplications,after.allow_applications],
    [[...(before.targetGroups??[])].sort().join(','),[...after.target_groups].sort().join(',')],
  ]
  return values.some(([a,b])=>(a??'')!==(b??''))
}
