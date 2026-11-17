export const GROUP_PARTICIPANTS_CHANGED = 'group-participants-changed'

export function notifyGroupParticipantsChanged(eventIds: number[] | null) {
  window.dispatchEvent(new CustomEvent<number[] | null>(GROUP_PARTICIPANTS_CHANGED, { detail: eventIds }))
}
