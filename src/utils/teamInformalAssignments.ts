import type { CalendarEvent, EventInformalAssignment } from '../types'

// Compatibility projection for existing recipient screens. No per-user rows are saved.
export function teamInformalAssignments(events: CalendarEvent[], legacy: EventInformalAssignment[]): EventInformalAssignment[] {
  const teamEvents = new Set(events.filter((e) => e.assignmentTeamInformal != null).map((e) => e.id))
  let id = -1
  return [
    ...legacy.filter((a) => !teamEvents.has(a.eventId)),
    ...events.flatMap((e) => e.cardAssignments.flatMap((a) =>
      (a.teamKey ? e.assignmentTeamInformal?.[a.teamKey] ?? [] : []).map((assetId) => ({
        id: id--, eventId: e.id, userName: a.userName, assetId,
        assignedBy: '', assignedAt: e.assignmentSharedAt ?? '', memo: '',
      })))),
  ]
}
