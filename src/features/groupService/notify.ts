import type { CalendarEvent } from '../../types'
import {sameMeetingAccess,type ServicePayload} from './model'

// Match private.service_event_notify; memo and assignment metadata are not notifications.
export function serviceEventChanged(before:Pick<CalendarEvent,'date'|'time'|'endTime'|'title'|'place'|'leader'|'mapLink'|'meetingMode'|'serviceKind'|'primaryLeaderUserId'|'allowApplications'|'targetGroups'>,after:ServicePayload) {
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

export function servicePayloadChanged(before:ServicePayload,after:ServicePayload){
  return serviceEventChanged({date:before.event_date,time:before.time,endTime:before.end_time,title:before.title,
    place:before.place,leader:before.leader_name,mapLink:before.meeting_map_url,meetingMode:before.meeting_mode,
    serviceKind:before.service_kind,primaryLeaderUserId:before.primary_leader_user_id,
    allowApplications:before.allow_applications,targetGroups:before.target_groups},after)
    || !sameMeetingAccess(before.access,after.access)
}
