export const GROUP_PARTICIPANTS_CHANGED = 'group-participants-changed'

export function notifyGroupParticipantsChanged(eventIds: number[]) {
  window.dispatchEvent(new CustomEvent<number[]>(GROUP_PARTICIPANTS_CHANGED, { detail: eventIds }))
}
